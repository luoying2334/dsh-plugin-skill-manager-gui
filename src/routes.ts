/**
 * HTTP routes bridging the browser skill-manager UI to the host filesystem.
 * This layer only parses requests, calls the {@link SkillStore}, and
 * serializes responses.
 *
 * Security: mutating routes (`write`, `remove`) write SKILL.md files with the
 * host user's permissions, so they are loopback-pinned and same-origin only.
 * Read routes (`list`, `read`) are harmless and stay open to the same
 * browser trust boundary as the rest of the web surface.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { assertLocalMutation, readJsonBody, sendJson } from './http.ts'
import { SkillError, SkillStore } from './skills.ts'
import type {
  SkillListResponse,
  SkillRemoveRequest,
  SkillScope,
  SkillWriteRequest,
} from './types.ts'

export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

export interface SkillManagerHost {
  webServer: WebServerService
  effect(callback: () => (() => void | Promise<void>) | void, label: string): void
}

export interface SkillManagerConfig {
  /** Absolute directory for the machine-global skill root (default `$DSH_HOME/skills`). */
  userSkillsDir?: string
  /** Absolute directory for the project skill root (default `<cwd>/.dsh/skills`). */
  projectSkillsDir?: string
}

const PREFIX = '/skill-manager'

/**
 * Register the skill-manager HTTP routes on the composed `webServer`.
 * @returns Disposer removing every registered route.
 */
export function mountSkillRoutes(host: SkillManagerHost, config: SkillManagerConfig = {}): () => void {
  const store = new SkillStore(config)

  return host.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(PREFIX.length) || '/'
      try {
        if (request.method === 'GET' && sub === '/list') {
          const body: SkillListResponse = { skills: store.listAll() }
          sendJson(response, 200, body)
          return
        }

        if (request.method === 'GET' && sub === '/read') {
          const scope = parseScope(url.searchParams.get('scope'))
          const name = url.searchParams.get('name') ?? ''
          const skill = store.read(scope, name)
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
          validateScope(payload.scope)
          const summary = store.write(payload)
          sendJson(response, 200, summary)
          return
        }

        if (request.method === 'POST' && sub === '/remove') {
          const localError = assertLocalMutation(request)
          if (localError !== null) {
            sendJson(response, 403, { error: localError })
            return
          }
          const payload = (await readJsonBody(request)) as SkillRemoveRequest
          validateScope(payload.scope)
          const removed = store.remove(payload.scope, payload.name)
          sendJson(response, 200, { removed })
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

function parseScope(value: string | null): SkillScope {
  return value === 'project' ? 'project' : 'user'
}

function validateScope(value: unknown): asserts value is SkillScope {
  if (value !== 'user' && value !== 'project') {
    throw new SkillError('scope must be "user" or "project"')
  }
}
