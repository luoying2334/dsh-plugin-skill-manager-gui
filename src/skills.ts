/**
 * Skill filesystem service: reads and writes SKILL.md bundles under the two
 * managed roots (`user` machine-global, `project` workspace-local), mirroring
 * the DSH skill-filesystem discovery roots so anything written here is picked
 * up by the harness on the next discovery pass.
 *
 * Skills are written as directory bundles `<root>/<name>/SKILL.md`. Foreign
 * flat files `<root>/<name>.md` are listed read-only but are never written.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { dump, load } from 'js-yaml'
import { SKILL_NAME_RE, type SkillBody, type SkillScope, type SkillSummary, type SkillWriteRequest } from './types.ts'

export interface SkillStoreConfig {
  /** Absolute directory for the machine-global skill root (default `$DSH_HOME/skills`). */
  userSkillsDir?: string
  /** Absolute directory for the project skill root (default `<cwd>/.dsh/skills`). */
  projectSkillsDir?: string
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
  private readonly roots: Record<SkillScope, string>

  constructor(config: SkillStoreConfig = {}) {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    this.roots = {
      user: resolve(config.userSkillsDir ?? join(dshHome, 'skills')),
      project: resolve(config.projectSkillsDir ?? join(process.cwd(), '.dsh', 'skills')),
    }
  }

  root(scope: SkillScope): string {
    return this.roots[scope]
  }

  /** Summaries for one scope, sorted by name. */
  list(scope: SkillScope): SkillSummary[] {
    const root = this.roots[scope]
    if (!existsSync(root)) return []
    const summaries: SkillSummary[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const absolute = join(root, entry.name)
      if (entry.isDirectory()) {
        const skillFile = join(absolute, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        const summary = this.summaryFrom(scope, skillFile, entry.name, readFileSync(skillFile, 'utf8'))
        if (summary !== null) summaries.push(summary)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const name = entry.name.slice(0, -3)
        const summary = this.summaryFrom(scope, absolute, name, readFileSync(absolute, 'utf8'))
        if (summary !== null) summaries.push(summary)
      }
    }
    summaries.sort((a, b) => a.name.localeCompare(b.name))
    return summaries
  }

  listAll(): SkillSummary[] {
    return [...this.list('user'), ...this.list('project')]
  }

  read(scope: SkillScope, name: string): SkillBody | null {
    this.assertName(name)
    const found = this.findSummary(scope, name)
    if (found === null) return null
    const { frontmatter, body } = parseSkillContent(readFileSync(found.path, 'utf8'))
    const parsed = this.parseFrontmatter(frontmatter, name)
    return {
      name,
      scope,
      description: parsed.description ?? found.description,
      whenToUse: parsed.whenToUse,
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
      path: dirname(found.path),
      content: body,
    }
  }

  /** Create or update a skill, returning its new summary. */
  write(request: SkillWriteRequest): SkillSummary {
    this.assertName(request.name)
    if (request.description.trim() === '') throw new SkillError('description is required')
    const scope: SkillScope = request.scope
    const root = this.roots[scope]
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
      scope,
      path: bundleDir,
    }
  }

  /** Remove a skill bundle. Returns true when something was removed. */
  remove(scope: SkillScope, name: string): boolean {
    this.assertName(name)
    const bundleDir = join(this.roots[scope], name)
    if (existsSync(bundleDir)) {
      rmSync(bundleDir, { recursive: true, force: true })
      return true
    }
    const flatFile = join(this.roots[scope], `${name}.md`)
    if (existsSync(flatFile)) {
      rmSync(flatFile, { force: true })
      return true
    }
    return false
  }

  private findSummary(scope: SkillScope, name: string): { path: string; description: string } | null {
    const root = this.roots[scope]
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

  private summaryFrom(scope: SkillScope, skillFile: string, fallbackName: string, content: string): SkillSummary | null {
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
      scope,
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
