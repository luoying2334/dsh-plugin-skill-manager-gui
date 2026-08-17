/**
 * ZIP skill import: extracts a zip of skill bundles into one target root.
 *
 * Accepted shapes per entry (paths are `/`-normalized):
 * - `<name>.md`            → a flat skill, rewritten as `<name>/SKILL.md`
 * - `<name>/SKILL.md`      → a directory bundle
 * - `<name>/<resource>`    → a nested resource, preserved under `<name>/`
 *
 * `name` must be kebab-case. Hidden entries (`.DS_Store`, `__MACOSX`, …) are
 * skipped. Entry paths are sanitized so no `..` or absolute path can escape
 * the target root.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import AdmZip from 'adm-zip'
import { SkillError } from './skills.ts'
import { SKILL_NAME_RE } from './types.ts'

export interface ImportResult {
  readonly imported: string[]
  readonly skipped: string[]
}

/**
 * Normalize and validate one zip entry path. Returns the `/`-separated path
 * parts, or `null` when the path is empty or could escape the target root
 * (`..` or an absolute path). Exported for direct testing.
 */
export function safeEntryParts(entryName: string): string[] | null {
  const normalized = entryName.replaceAll('\\', '/')
  if (normalized.startsWith('/')) return null
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((part) => part === '..')) return null
  return parts
}

/** Extract a zip buffer into `targetRoot`, returning the imported skill names. */
export function importSkillsFromZip(zipBytes: Buffer, targetRoot: string): ImportResult {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipBytes)
  } catch {
    throw new SkillError('not a valid zip archive')
  }

  const imported = new Set<string>()
  const skipped: string[] = []

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const parts = safeEntryParts(entry.entryName)
    if (parts === null) {
      throw new SkillError(`unsafe entry path in zip: ${entry.entryName}`)
    }
    const first = parts[0] as string
    if (first.startsWith('.') || first === '__MACOSX') {
      skipped.push(entry.entryName)
      continue
    }

    let name: string
    let relative: string[]
    if (parts.length === 1 && first.endsWith('.md')) {
      name = first.slice(0, -3)
      relative = ['SKILL.md']
    } else {
      name = first
      relative = parts.slice(1)
    }

    if (!SKILL_NAME_RE.test(name)) {
      throw new SkillError(`invalid skill name in zip: "${name}" (must be kebab-case)`)
    }

    const destination = join(targetRoot, name, ...relative)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, entry.getData())
    imported.add(name)
  }

  return { imported: [...imported].sort(), skipped }
}
