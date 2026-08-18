import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importSkillsFromZip, safeEntryParts } from '../src/import.ts'
import { SkillError } from '../src/skills.ts'

let dir: string
let root: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-import-'))
  root = join(dir, 'skills')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function zip(entries: Record<string, string>): Buffer {
  const archive = new AdmZip()
  for (const [name, content] of Object.entries(entries)) {
    archive.addFile(name, Buffer.from(content))
  }
  return archive.toBuffer()
}

describe('importSkillsFromZip', () => {
  it('imports directory bundles and flat skills', () => {
    const result = importSkillsFromZip(zip({
      'code-review/SKILL.md': '---\nname: code-review\ndescription: d\n---\nbody',
      'writer.md': '---\nname: writer\ndescription: d\n---\nbody',
    }), root)
    expect(result.imported.sort()).toEqual(['code-review', 'writer'])
    expect(existsSync(join(root, 'code-review', 'SKILL.md'))).toBe(true)
    // Flat `<name>.md` entries are normalized into directory bundles.
    expect(existsSync(join(root, 'writer', 'SKILL.md'))).toBe(true)
  })

  it('preserves nested resources under a bundle', () => {
    importSkillsFromZip(zip({
      'code-review/SKILL.md': '---\nname: code-review\ndescription: d\n---\nbody',
      'code-review/references/api.md': '# refs',
    }), root)
    expect(existsSync(join(root, 'code-review', 'references', 'api.md'))).toBe(true)
  })

  it('unwraps a zipped folder of skills', () => {
    const result = importSkillsFromZip(zip({
      'my-skills/code-review/SKILL.md': '---\nname: code-review\ndescription: d\n---\nbody',
      'my-skills/writer/SKILL.md': '---\nname: writer\ndescription: d\n---\nbody',
    }), root)
    expect(result.imported.sort()).toEqual(['code-review', 'writer'])
    expect(existsSync(join(root, 'code-review', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'my-skills'))).toBe(false)
  })

  it('unwraps a zipped folder containing a single skill', () => {
    const result = importSkillsFromZip(zip({
      'my-skills/code-review/SKILL.md': '---\nname: code-review\ndescription: d\n---\nbody',
    }), root)
    expect(result.imported).toEqual(['code-review'])
  })

  it('skips stray top-level docs inside a wrapper', () => {
    const result = importSkillsFromZip(zip({
      'my-skills/README.md': '# docs',
      'my-skills/code-review/SKILL.md': '---\nname: code-review\ndescription: d\n---\nbody',
    }), root)
    expect(result.imported).toEqual(['code-review'])
    expect(existsSync(join(root, 'README'))).toBe(false)
  })

  it('rejects path traversal and absolute paths', () => {
    expect(safeEntryParts('../evil/SKILL.md')).toBeNull()
    expect(safeEntryParts('a/../../evil')).toBeNull()
    expect(safeEntryParts('/abs/SKILL.md')).toBeNull()
    expect(safeEntryParts('a\\..\\evil')).toBeNull()
    expect(safeEntryParts('ok/SKILL.md')).toEqual(['ok', 'SKILL.md'])
  })

  it('rejects invalid skill names', () => {
    expect(() => importSkillsFromZip(zip({ 'Bad Name/SKILL.md': 'x' }), root)).toThrow(SkillError)
  })

  it('skips hidden and macOS entries', () => {
    const result = importSkillsFromZip(zip({
      '__MACOSX/junk': 'x',
      '.DS_Store': 'x',
      'ok/SKILL.md': '---\nname: ok\ndescription: d\n---\nbody',
    }), root)
    expect(result.imported).toEqual(['ok'])
  })

  it('rejects non-zip input', () => {
    expect(() => importSkillsFromZip(Buffer.from('not a zip'), root)).toThrow(SkillError)
  })
})
