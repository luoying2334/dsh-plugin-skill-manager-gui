/**
 * Skill filesystem service: reads and writes SKILL.md bundles under the
 * managed roots — the machine-global `user` root (`$DSH_HOME/skills`) and one
 * workspace-local root per selected workspace (`<workspace>/.dsh/skills`).
 * Both mirror the DSH skill-filesystem discovery roots so anything written
 * here is picked up by the harness on the next discovery pass.
 *
 * Skills are written as directory bundles `<root>/<name>/SKILL.md`. Foreign
 * flat files `<root>/<name>.md` are listed read-only but are never written.
 *
 * This service works one root at a time; the routes layer groups per-root
 * entries by name into the client-facing `SkillSummary`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { dump, load } from 'js-yaml'
import { SKILL_NAME_RE, type SkillBody, type SkillScope, type SkillTarget, type SkillWriteRequest } from './types.ts'

export interface SkillStoreConfig {
  /** Absolute directory for the machine-global skill root (default `$DSH_HOME/skills`). */
  userSkillsDir?: string
}

/** One skill file entry under a single root. */
export interface SkillEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly target: SkillTarget
  readonly path: string
}

interface ParsedFrontmatter {
  name?: string
  description?: string
  whenToUse?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
}

/** Coerce the boolean frontmatter spellings accepted by DSH's skill-filesystem provider. */
function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(lower)) return true
    if (['false', 'no', 'off', '0'].includes(lower)) return false
  }
  return fallback
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Split a SKILL.md file into `{ frontmatter, body }`. */
function parseSkillContent(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(content)
  if (match === null) return { frontmatter: {}, body: content }
  const parsed = load(match[1] ?? '') as Record<string, unknown> | null
  return { frontmatter: parsed ?? {}, body: match[2] ?? '' }
}

/** Serialize a skill body with a normalized frontmatter block. */
function serializeSkill(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = dump(frontmatter, { lineWidth: -1, quotingType: '"' }).trimEnd()
  return `---\n${yaml}\n---\n\n${body.replace(/\s+$/, '')}\n`
}

export class SkillError extends Error {}

export class SkillStore {
  private readonly userDir: string

  constructor(config: SkillStoreConfig = {}) {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    this.userDir = resolve(config.userSkillsDir ?? join(dshHome, 'skills'))
  }

  /** Absolute machine-global skill root. */
  userRoot(): string {
    return this.userDir
  }

  /** Absolute workspace-local skill root for one workspace directory. */
  workspaceRoot(workspacePath: string): string {
    return join(workspacePath, '.dsh', 'skills')
  }

  /** Resolve a target into its root directory plus scope metadata. */
  resolveTarget(target: SkillTarget): { root: string; scope: SkillScope; workspacePath?: string } {
    if (target.scope === 'user') return { root: this.userDir, scope: 'user' }
    if (target.scope === 'workspace') {
      if (target.workspacePath === undefined || target.workspacePath === '') {
        throw new SkillError('workspace path is required for workspace scope')
      }
      return { root: this.workspaceRoot(target.workspacePath), scope: 'workspace', workspacePath: target.workspacePath }
    }
    throw new SkillError(`invalid scope: ${String(target.scope)}`)
  }

  /** Per-root entries under one root, sorted by name. */
  list(root: string, scope: SkillScope, workspacePath?: string): SkillEntry[] {
    if (!existsSync(root)) return []
    const entries: SkillEntry[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const absolute = join(root, entry.name)
      if (entry.isDirectory()) {
        const skillFile = join(absolute, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        const summary = this.entryFrom(scope, workspacePath, skillFile, entry.name, readFileSync(skillFile, 'utf8'))
        if (summary !== null) entries.push(summary)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const name = entry.name.slice(0, -3)
        const summary = this.entryFrom(scope, workspacePath, absolute, name, readFileSync(absolute, 'utf8'))
        if (summary !== null) entries.push(summary)
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries
  }

  /** Read one skill's full body under a root, or null when absent. */
  read(root: string, scope: SkillScope, workspacePath: string | undefined, name: string): SkillBody | null {
    this.assertName(name)
    const found = this.findSummary(root, name)
    if (found === null) return null
    const { frontmatter, body } = parseSkillContent(readFileSync(found.path, 'utf8'))
    const parsed = this.parseFrontmatter(frontmatter, name)
    return {
      name,
      description: parsed.description ?? found.description,
      whenToUse: parsed.whenToUse,
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
      content: body,
      target: { scope, workspacePath },
      path: dirname(found.path),
    }
  }

  /** Create or update a skill under one root, returning its entry. */
  write(root: string, scope: SkillScope, workspacePath: string | undefined, request: SkillWriteRequest): SkillEntry {
    this.assertName(request.name)
    if (request.description.trim() === '') throw new SkillError('description is required')
    const bundleDir = join(root, request.name)
    const skillFile = join(bundleDir, 'SKILL.md')

    // Reject a name that collides with a foreign flat-file skill in the same root.
    const flatFile = join(root, `${request.name}.md`)
    if (existsSync(flatFile) && !existsSync(bundleDir)) {
      throw new SkillError(`a flat skill file already exists at ${flatFile}; rename or remove it first`)
    }

    const frontmatter: Record<string, unknown> = {
      name: request.name,
      description: request.description.trim(),
    }
    if (request.whenToUse !== undefined && request.whenToUse.trim() !== '') {
      frontmatter.whenToUse = request.whenToUse.trim()
    }
    frontmatter['disable-model-invocation'] = !request.modelInvocable
    frontmatter['user-invocable'] = request.userInvocable

    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(skillFile, serializeSkill(frontmatter, request.content), 'utf8')

    return {
      name: request.name,
      description: request.description.trim(),
      whenToUse: request.whenToUse?.trim() || undefined,
      modelInvocable: request.modelInvocable,
      userInvocable: request.userInvocable,
      target: { scope, workspacePath },
      path: bundleDir,
    }
  }

  /** Remove a skill bundle under one root. Returns true when something was removed. */
  remove(root: string, name: string): boolean {
    this.assertName(name)
    const bundleDir = join(root, name)
    if (existsSync(bundleDir)) {
      rmSync(bundleDir, { recursive: true, force: true })
      return true
    }
    const flatFile = join(root, `${name}.md`)
    if (existsSync(flatFile)) {
      rmSync(flatFile, { force: true })
      return true
    }
    return false
  }

  private findSummary(root: string, name: string): { path: string; description: string } | null {
    const bundle = join(root, name, 'SKILL.md')
    if (existsSync(bundle)) {
      const parsed = this.parseFrontmatter(parseSkillContent(readFileSync(bundle, 'utf8')).frontmatter, name)
      return { path: bundle, description: parsed.description ?? '' }
    }
    const flat = join(root, `${name}.md`)
    if (existsSync(flat)) {
      const parsed = this.parseFrontmatter(parseSkillContent(readFileSync(flat, 'utf8')).frontmatter, name)
      return { path: flat, description: parsed.description ?? '' }
    }
    return null
  }

  private entryFrom(scope: SkillScope, workspacePath: string | undefined, skillFile: string, fallbackName: string, content: string): SkillEntry | null {
    const { frontmatter } = parseSkillContent(content)
    const parsed = this.parseFrontmatter(frontmatter, fallbackName)
    const name = parsed.name ?? fallbackName
    if (!SKILL_NAME_RE.test(name)) return null
    if (parsed.description === undefined) return null
    return {
      name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
      target: { scope, workspacePath },
      path: dirname(skillFile),
    }
  }

  private parseFrontmatter(frontmatter: Record<string, unknown>, fallbackName: string): ParsedFrontmatter {
    return {
      name: asString(frontmatter.name) ?? fallbackName,
      description: asString(frontmatter.description),
      whenToUse: asString(frontmatter.whenToUse),
      disableModelInvocation: frontmatter['disable-model-invocation'] === undefined
        ? undefined
        : parseBool(frontmatter['disable-model-invocation'], false),
      userInvocable: frontmatter['user-invocable'] === undefined
        ? undefined
        : parseBool(frontmatter['user-invocable'], true),
    }
  }

  private assertName(name: string): void {
    if (!SKILL_NAME_RE.test(name)) {
      throw new SkillError(`invalid skill name "${name}": must be kebab-case (${SKILL_NAME_RE.source})`)
    }
  }
}
