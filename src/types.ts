/**
 * Wire types shared by the host service and the browser client.
 *
 * These are plain JSON-friendly shapes so they serialize cleanly over the
 * HTTP boundary. Only the host is authoritative about validation; the client
 * reuses these types for type safety and performs light, non-authoritative
 * checks before sending.
 */

/** Where a managed skill lives. `user` is the machine-global root, `project` is the workspace-local root. */
export type SkillScope = 'user' | 'project'

/** Kebab-case skill name, matching the DSH skill-filesystem contract. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Summary of one skill, the shape returned by `GET /skill-manager/list`. */
export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** Mirrors the `disable-model-invocation` frontmatter (inverted). */
  readonly modelInvocable: boolean
  /** Mirrors the `user-invocable` frontmatter. */
  readonly userInvocable: boolean
  readonly scope: SkillScope
  /** Absolute directory of the skill bundle on the host (informational). */
  readonly path: string
}

/** Full skill body, the shape returned by `GET /skill-manager/read`. */
export interface SkillBody extends SkillSummary {
  /** The markdown instruction body (frontmatter stripped). */
  readonly content: string
}

/** Payload for `POST /skill-manager/write` (create or update). */
export interface SkillWriteRequest {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly scope: SkillScope
  readonly content: string
}

/** Payload for `POST /skill-manager/remove`. */
export interface SkillRemoveRequest {
  readonly name: string
  readonly scope: SkillScope
}

/** Uniform error envelope for non-2xx responses. */
export interface SkillErrorResponse {
  readonly error: string
}

/** Response for `GET /skill-manager/list`. */
export interface SkillListResponse {
  readonly skills: SkillSummary[]
}
