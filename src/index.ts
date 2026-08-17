/**
 * dsh-skill-manager host entry: mounts the skill-manager HTTP routes once the
 * profile composes the `webServer` service.
 */

import type { Context } from '@deepseek-ai/cordis'
import { mountSkillRoutes, type SkillManagerConfig, type SkillManagerHost } from './routes.ts'

export const name = 'dsh-skill-manager'

/** Optional cordis.yml configuration; defaults resolve `$DSH_HOME/skills` and `<cwd>/.dsh/skills`. */
export type Config = SkillManagerConfig

export function apply(ctx: Context, config?: Config): void {
  ctx.inject(['webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as SkillManagerHost
    const resolved: SkillManagerConfig = { ...(config ?? {}) }
    host.effect(
      () => mountSkillRoutes(host, resolved),
      'dsh-skill-manager: http routes',
    )
  })
}
