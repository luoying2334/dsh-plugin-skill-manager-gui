import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillError, SkillStore } from '../src/skills.ts'

let dir: string
let store: SkillStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-manager-'))
  store = new SkillStore({ userSkillsDir: join(dir, 'user'), projectSkillsDir: join(dir, 'project') })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SkillStore', () => {
  it('writes a directory bundle and reads it back', () => {
    store.write({
      name: 'code-review',
      description: 'Review code for bugs',
      scope: 'user',
      modelInvocable: true,
      userInvocable: true,
      content: '# Steps\n1. Read the diff',
    })
    expect(existsSync(join(store.root('user'), 'code-review', 'SKILL.md'))).toBe(true)

    const skill = store.read('user', 'code-review')
    expect(skill).not.toBeNull()
    expect(skill?.name).toBe('code-review')
    expect(skill?.description).toBe('Review code for bugs')
    expect(skill?.content).toContain('1. Read the diff')
  })

  it('round-trips invocation flags through frontmatter', () => {
    store.write({
      name: 'user-only',
      description: 'user-only skill',
      scope: 'project',
      modelInvocable: false,
      userInvocable: true,
      content: 'body',
    })
    const skill = store.read('project', 'user-only')
    expect(skill?.modelInvocable).toBe(false)
    expect(skill?.userInvocable).toBe(true)
  })

  it('lists skills per scope and across both scopes', () => {
    store.write({ name: 'a-skill', description: 'A', scope: 'user', modelInvocable: true, userInvocable: true, content: 'x' })
    store.write({ name: 'b-skill', description: 'B', scope: 'project', modelInvocable: true, userInvocable: true, content: 'y' })

    expect(store.list('user').map((skill) => skill.name)).toEqual(['a-skill'])
    expect(store.list('project').map((skill) => skill.name)).toEqual(['b-skill'])
    expect(store.listAll().map((skill) => skill.name).sort()).toEqual(['a-skill', 'b-skill'])
  })

  it('rejects non-kebab-case names', () => {
    expect(() => store.write({
      name: 'Bad Name',
      description: 'd',
      scope: 'user',
      modelInvocable: true,
      userInvocable: true,
      content: 'x',
    })).toThrow(SkillError)
  })

  it('requires a description', () => {
    expect(() => store.write({
      name: 'valid-name',
      description: '   ',
      scope: 'user',
      modelInvocable: true,
      userInvocable: true,
      content: 'x',
    })).toThrow(SkillError)
  })

  it('removes a skill bundle and reports missing removals', () => {
    store.write({ name: 'temp', description: 'd', scope: 'user', modelInvocable: true, userInvocable: true, content: 'x' })
    expect(store.remove('user', 'temp')).toBe(true)
    expect(store.read('user', 'temp')).toBeNull()
    expect(store.remove('user', 'temp')).toBe(false)
  })

  it('returns null when reading a missing skill', () => {
    expect(store.read('user', 'does-not-exist')).toBeNull()
  })
})
