import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillError, SkillStore } from '../src/skills.ts'
import type { SkillWriteRequest } from '../src/types.ts'

let dir: string
let store: SkillStore
let userRoot: string
let workspaceRoot: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-manager-'))
  store = new SkillStore({ userSkillsDir: join(dir, 'user') })
  userRoot = store.userRoot()
  workspaceRoot = store.workspaceRoot(join(dir, 'workspace'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function request(overrides: Partial<SkillWriteRequest> = {}): SkillWriteRequest {
  return {
    name: 'code-review',
    description: 'Review code for bugs',
    modelInvocable: true,
    userInvocable: true,
    content: '# Steps\n1. Read the diff',
    targets: [{ scope: 'user' }],
    ...overrides,
  }
}

describe('SkillStore', () => {
  it('writes a directory bundle and reads it back', () => {
    store.write(userRoot, 'user', undefined, request())
    expect(existsSync(join(userRoot, 'code-review', 'SKILL.md'))).toBe(true)

    const skill = store.read(userRoot, 'user', undefined, 'code-review')
    expect(skill).not.toBeNull()
    expect(skill?.name).toBe('code-review')
    expect(skill?.description).toBe('Review code for bugs')
    expect(skill?.content).toContain('1. Read the diff')
  })

  it('writes into a workspace root and tags the summary with scope + path', () => {
    store.write(workspaceRoot, 'workspace', join(dir, 'workspace'), request())
    const skill = store.read(workspaceRoot, 'workspace', join(dir, 'workspace'), 'code-review')
    expect(skill?.target.scope).toBe('workspace')
    expect(skill?.target.workspacePath).toBe(join(dir, 'workspace'))
  })

  it('round-trips invocation flags through frontmatter', () => {
    store.write(userRoot, 'user', undefined, request({ modelInvocable: false, userInvocable: true }))
    const skill = store.read(userRoot, 'user', undefined, 'code-review')
    expect(skill?.modelInvocable).toBe(false)
    expect(skill?.userInvocable).toBe(true)
  })

  it('lists skills under a root', () => {
    store.write(userRoot, 'user', undefined, request({ name: 'a-skill', description: 'A', content: 'x' }))
    store.write(userRoot, 'user', undefined, request({ name: 'b-skill', description: 'B', content: 'y' }))
    expect(store.list(userRoot, 'user', undefined).map((skill) => skill.name)).toEqual(['a-skill', 'b-skill'])
  })

  it('resolves a workspace target to <workspace>/.dsh/skills', () => {
    const resolved = store.resolveTarget({ scope: 'workspace', workspacePath: join(dir, 'ws') })
    expect(resolved.root).toBe(join(dir, 'ws', '.dsh', 'skills'))
    expect(resolved.scope).toBe('workspace')
  })

  it('rejects non-kebab-case names', () => {
    expect(() => store.write(userRoot, 'user', undefined, request({ name: 'Bad Name' }))).toThrow(SkillError)
  })

  it('requires a description', () => {
    expect(() => store.write(userRoot, 'user', undefined, request({ description: '   ' }))).toThrow(SkillError)
  })

  it('removes a skill bundle and reports missing removals', () => {
    store.write(userRoot, 'user', undefined, request({ name: 'temp', description: 'd', content: 'x' }))
    expect(store.remove(userRoot, 'temp')).toBe(true)
    expect(store.read(userRoot, 'user', undefined, 'temp')).toBeNull()
    expect(store.remove(userRoot, 'temp')).toBe(false)
  })

  it('returns null when reading a missing skill', () => {
    expect(store.read(userRoot, 'user', undefined, 'does-not-exist')).toBeNull()
  })
})
