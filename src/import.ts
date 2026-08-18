/**
 * ZIP skill import: extracts a zip of skill bundles into one target root.
 *
 * Accepted shapes per entry (paths are `/`-normalized):
 * - `<name>.md`            → a flat skill, rewritten as `<name>/SKILL.md`
 * - `<name>/SKILL.md`      → a directory bundle
 * - `<name>/<resource>`    → a nested resource, preserved under `<name>/`
 *
 * A zip of a *folder* (one shared wrapper directory with no `SKILL.md` of its
 * own) is unwrapped automatically, so zipping a directory full of skills just
 * works. `name` must be kebab-case; stray top-level docs (`README.md`,
 * `LICENSE`, …) and hidden entries (`.DS_Store`, `__MACOSX`, …) are skipped.
 * Entry paths are sanitized so no `..` or absolute path can escape the target.
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

interface ZipFile {
  readonly entryName: string
  parts: string[]
  readonly getData: () => Buffer
}

/** Extract a zip buffer into `targetRoot`, returning the imported skill names. */
export function importSkillsFromZip(zipBytes: Buffer, targetRoot: string): ImportResult {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipBytes)
  } catch {
    throw new SkillError('not a valid zip archive')
  }

  const files: ZipFile[] = []
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
    files.push({ entryName: entry.entryName, parts, getData: () => entry.getData() })
  }

  // Unwrap a single shared wrapper directory (the "zip a folder" shape):
  // every file shares one top-level segment, and that segment has no SKILL.md
  // of its own — its children are the actual skills.
  if (files.length > 0) {
    const root = files[0].parts[0] as string
    const allSameRoot = files.every((file) => file.parts[0] === root)
    const rootIsSkill = files.some((file) => file.parts.length === 2 && file.parts[1] === 'SKILL.md')
    if (allSameRoot && !rootIsSkill && files.every((file) => file.parts.length >= 2)) {
      for (const file of files) file.parts = file.parts.slice(1)
    }
  }

  const imported = new Set<string>()

  for (const file of files) {
    const parts = file.parts
    if (parts.length === 0) continue
    const first = parts[0] as string

    if (parts.length === 1 && first.endsWith('.md')) {
      const flatName = first.slice(0, -3)
      if (!SKILL_NAME_RE.test(flatName)) {
        skipped.push(file.entryName)
        continue
      }
      const destination = join(targetRoot, flatName, 'SKILL.md')
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, file.getData())
      imported.add(flatName)
      continue
    }

    const name = first
    if (!SKILL_NAME_RE.test(name)) {
      throw new SkillError(`invalid skill name in zip: "${name}" (must be kebab-case)`)
    }
    const relative = parts.slice(1)
    const destination = join(targetRoot, name, ...relative)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.getData())
    imported.add(name)
  }

  return { imported: [...imported].sort(), skipped }
}
