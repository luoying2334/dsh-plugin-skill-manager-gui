/**
 * dsh-plugin-skill-manager-gui host entry: mounts the skill-manager HTTP routes once the
 * profile composes the `webServer` and `workspaceRegistry` services.
 */

import type { Context } from '@deepseek-ai/cordis'
import { mountSkillRoutes, type SkillManagerConfig, type SkillManagerHost } from './routes.ts'

export const name = 'dsh-plugin-skill-manager-gui'

/** Optional cordis.yml configuration; `userSkillsDir` defaults to `$DSH_HOME/skills`. */
export type Config = SkillManagerConfig

export function apply(ctx: Context, config?: Config): void {
  ctx.inject(['webServer', 'workspaceRegistry'], (hostCtx: Context) => {
    const host = hostCtx as unknown as SkillManagerHost
    const resolved: SkillManagerConfig = { ...(config ?? {}) }
    host.effect(
      () => mountSkillRoutes(host, resolved),
      'dsh-plugin-skill-manager-gui: http routes',
    )
  })
}
