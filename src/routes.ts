/**
 * HTTP routes bridging the browser skill-manager UI to the host filesystem.
 * This layer only parses requests, calls {@link SkillStore} /
 * {@link importSkillsFromZip}, and serializes responses.
 *
 * Security: mutating routes (`write`, `remove`, `import`) write files with the
 * host user's permissions, so they are loopback-pinned and same-origin only.
 * Read routes (`list`, `read`, `workspaces`) are harmless and stay inside the
 * same browser-trust boundary as the rest of the web surface.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { assertLocalMutation, readBody, readJsonBody, sendJson } from './http.ts'
import { importSkillsFromZip } from './import.ts'
import { SkillError, SkillStore } from './skills.ts'
import type {
  SkillImportResponse,
  SkillListResponse,
  SkillRemoveRequest,
  SkillTarget,
  SkillWorkspacesResponse,
  SkillWriteRequest,
} from './types.ts'

export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Structural subset of the host workspace entity. */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** Structural subset of `ctx.workspaceRegistry`. */
export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
}

export interface SkillManagerHost {
  webServer: WebServerService
  workspaceRegistry: WorkspaceRegistryLike
  effect(callback: () => (() => void | Promise<void>) | void, label: string): void
}

export interface SkillManagerConfig {
  /** Absolute directory for the machine-global skill root (default `$DSH_HOME/skills`). */
  userSkillsDir?: string
}

const PREFIX = '/skill-manager'

interface ResolvedRoot {
  readonly target: SkillTarget
  readonly root: string
}

/**
 * Register the skill-manager HTTP routes on the composed `webServer`.
 * @returns Disposer removing every registered route.
 */
export function mountSkillRoutes(host: SkillManagerHost, config: SkillManagerConfig = {}): () => void {
  const store = new SkillStore(config)

  const resolveRoots = (): ResolvedRoot[] => {
    const roots: ResolvedRoot[] = [
      { target: { scope: 'user' }, root: store.userRoot() },
    ]
    for (const workspace of host.workspaceRegistry.list()) {
      roots.push({
        target: { scope: 'workspace', workspacePath: workspace.path },
        root: store.workspaceRoot(workspace.path),
      })
    }
    return roots
  }

  const resolveTarget = (target: SkillTarget): ResolvedRoot => {
    const resolved = store.resolveTarget(target)
    return { target, root: resolved.root }
  }

  return host.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(PREFIX.length) || '/'
      try {
        if (request.method === 'GET' && sub === '/list') {
          const skills = resolveRoots().flatMap((entry) => (
            store.list(entry.root, entry.target.scope, entry.target.workspacePath)
          ))
          const body: SkillListResponse = { skills }
          sendJson(response, 200, body)
          return
        }

        if (request.method === 'GET' && sub === '/workspaces') {
          const workspaces = host.workspaceRegistry.list().map((workspace) => ({
            id: workspace.id,
            path: workspace.path,
            title: workspace.title || basename(workspace.path),
          }))
          const body: SkillWorkspacesResponse = { workspaces }
          sendJson(response, 200, body)
          return
        }

        if (request.method === 'GET' && sub === '/read') {
          const target = targetFromQuery(url.searchParams)
          const entry = resolveTarget(target)
          const name = url.searchParams.get('name') ?? ''
          const skill = store.read(entry.root, entry.target.scope, entry.target.workspacePath, name)
          if (skill === null) {
            sendJson(response, 404, { error: `skill "${name}" not found` })
            return
          }
          sendJson(response, 200, skill)
          return
        }

        if (request.method === 'POST' && sub === '/write') {
          const localError = assertLocalMutation(request)
          if (localError !== null) {
            sendJson(response, 403, { error: localError })
            return
          }
          const payload = (await readJsonBody(request)) as SkillWriteRequest
          validateTargets(payload.targets)
          if (payload.previousTarget !== undefined) validateTarget(payload.previousTarget)
          const summaries = payload.targets.map((target) => {
            const entry = resolveTarget(target)
            return store.write(entry.root, entry.target.scope, entry.target.workspacePath, payload)
          })
          // Move: when the edited instance's previous location is no longer a target, remove it.
          if (payload.previousTarget !== undefined && !payload.targets.some((target) => sameTarget(target, payload.previousTarget as SkillTarget))) {
            const previous = resolveTarget(payload.previousTarget)
            store.remove(previous.root, payload.name)
          }
          sendJson(response, 200, { summaries })
          return
        }

        if (request.method === 'POST' && sub === '/remove') {
          const localError = assertLocalMutation(request)
          if (localError !== null) {
            sendJson(response, 403, { error: localError })
            return
          }
          const payload = (await readJsonBody(request)) as SkillRemoveRequest
          validateTarget(payload.target)
          const entry = resolveTarget(payload.target)
          const removed = store.remove(entry.root, payload.name)
          sendJson(response, 200, { removed })
          return
        }

        if (request.method === 'POST' && sub === '/import') {
          const localError = assertLocalMutation(request)
          if (localError !== null) {
            sendJson(response, 403, { error: localError })
            return
          }
          const target = targetFromQuery(url.searchParams)
          const entry = resolveTarget(target)
          const zipBytes = await readBody(request)
          const result = importSkillsFromZip(zipBytes, entry.root)
          const body: SkillImportResponse = { imported: result.imported }
          sendJson(response, 200, body)
          return
        }

        sendJson(response, 404, { error: 'not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'internal error'
        const status = error instanceof SkillError ? 400 : 500
        sendJson(response, status, { error: message })
      }
    },
  })
}

function targetFromQuery(params: URLSearchParams): SkillTarget {
  const scope = params.get('scope') === 'workspace' ? 'workspace' : 'user'
  if (scope === 'workspace') {
    const workspacePath = params.get('workspace') ?? undefined
    return { scope, workspacePath }
  }
  return { scope }
}

function validateTarget(value: unknown): asserts value is SkillTarget {
  if (value === null || typeof value !== 'object') throw new SkillError('invalid target')
  const target = value as Record<string, unknown>
  if (target.scope !== 'user' && target.scope !== 'workspace') {
    throw new SkillError('scope must be "user" or "workspace"')
  }
  if (target.scope === 'workspace' && typeof target.workspacePath !== 'string') {
    throw new SkillError('workspacePath is required for workspace scope')
  }
}

function validateTargets(value: unknown): asserts value is readonly SkillTarget[] {
  if (!Array.isArray(value) || value.length === 0) throw new SkillError('at least one target is required')
  for (const target of value) validateTarget(target)
}

function sameTarget(left: SkillTarget, right: SkillTarget): boolean {
  if (left.scope !== right.scope) return false
  if (left.scope === 'workspace') return left.workspacePath === right.workspacePath
  return true
}
