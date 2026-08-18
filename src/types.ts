/**
 * Wire types shared by the host service and the browser client.
 *
 * Plain JSON-friendly shapes so they serialize cleanly over the HTTP
 * boundary. Only the host is authoritative about validation; the client
 * reuses these types for type safety and performs light, non-authoritative
 * checks before sending.
 */

/** Where a managed skill lives: the machine-global root, or one workspace-local root. */
export type SkillScope = 'user' | 'workspace'

/** One installation target: the global root, or a specific workspace directory. */
export interface SkillTarget {
  readonly scope: SkillScope
  /** Required when `scope === 'workspace'`. */
  readonly workspacePath?: string
}

/** One host workspace, the shape returned by `GET /skill-manager/workspaces`. */
export interface WorkspaceInfo {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** Kebab-case skill name, matching the DSH skill-filesystem contract. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A skill grouped by name, the shape returned by `GET /skill-manager/list`. */
export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** Mirrors the `disable-model-invocation` frontmatter (inverted). */
  readonly modelInvocable: boolean
  /** Mirrors the `user-invocable` frontmatter. */
  readonly userInvocable: boolean
  /** Every location this skill is installed to (one or more). */
  readonly locations: SkillTarget[]
  /** Bundle directory of the first location (informational). */
  readonly path: string
}

/** Full body of one instance, the shape returned by `GET /skill-manager/read`. */
export interface SkillBody {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  /** The markdown instruction body (frontmatter stripped). */
  readonly content: string
  /** The specific instance this body was read from. */
  readonly target: SkillTarget
  /** Absolute directory of the skill bundle on the host. */
  readonly path: string
}

/** Payload for `POST /skill-manager/write` (create or update). */
export interface SkillWriteRequest {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly content: string
  /** One or more install locations (global, or one or more workspaces — never mixed). */
  readonly targets: readonly SkillTarget[]
  /** When editing, the skill's previous locations — any not in `targets` are removed. */
  readonly previousTargets?: readonly SkillTarget[]
}

/** Payload for `POST /skill-manager/remove`. */
export interface SkillRemoveRequest {
  readonly name: string
  /** Remove the skill from each of these locations. */
  readonly targets: readonly SkillTarget[]
}

/** Uniform error envelope for non-2xx responses. */
export interface SkillErrorResponse {
  readonly error: string
}

/** Response for `GET /skill-manager/list`. */
export interface SkillListResponse {
  readonly skills: SkillSummary[]
}

/** Response for `GET /skill-manager/workspaces`. */
export interface SkillWorkspacesResponse {
  readonly workspaces: WorkspaceInfo[]
}

/** Response for `POST /skill-manager/import`. */
export interface SkillImportResponse {
  readonly imported: string[]
}
