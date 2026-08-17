/**
 * dsh-plugin-skill-manager-gui client: registers a "Skills" settings section rendering
 * the skill manager UI. Built by tsdown into the `__ModuleLoader__` factory
 * bundle at client/client.js; the only externals are the loader module
 * table's `react` and `@deepseek-ai/dsh-client-ui-primitives` entries.
 */
import { createElement as h } from 'react'
import { en, zh, type Translate } from './locales.ts'
import { SkillManager } from './SkillManager.tsx'

const NS = 'dsh-plugin-skill-manager-gui'

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The client cordis context shape this plugin relies on (structural typing keeps this package free of monorepo-internal type dependencies). */
interface SkillManagerClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-plugin-skill-manager-gui'
export const inject = ['slots', 'locale']

export function apply(ctx: SkillManagerClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-skill-manager-gui: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skill-manager',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(SkillManager, { t })))
}
