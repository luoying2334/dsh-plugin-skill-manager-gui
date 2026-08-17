/**
 * Skill manager settings section: lists managed skills, and provides
 * create / edit / delete flows backed by the host HTTP routes under
 * `/skill-manager`.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { createElement as h, Fragment } from 'react'
import { Button, Input, Modal, IconPlusOutline16, IconEditOutline16, IconTrashOutline16, IconSkillOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SKILL_NAME_RE, type SkillBody, type SkillScope, type SkillSummary, type SkillWriteRequest } from '../types.ts'
import type { Translate } from './locales.ts'
import css from './SkillManager.module.css'

interface SkillDraft {
  name: string
  description: string
  whenToUse: string
  scope: SkillScope
  modelInvocable: boolean
  userInvocable: boolean
  content: string
  originalName?: string
}

const EMPTY_DRAFT: SkillDraft = {
  name: '',
  description: '',
  whenToUse: '',
  scope: 'user',
  modelInvocable: true,
  userInvocable: true,
  content: '',
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `request failed (${response.status})`)
  return body
}

export function SkillManager({ t }: { t: Translate }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SkillSummary | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchJson<{ skills: SkillSummary[] }>('/skill-manager/list')
      setSkills(data.skills)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('error.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return skills
    return skills.filter((skill) => (
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
    ))
  }, [skills, query])

  const openNew = () => {
    setFormError(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  const openEdit = async (summary: SkillSummary) => {
    setFormError(null)
    try {
      const body = await fetchJson<SkillBody>(`/skill-manager/read?name=${encodeURIComponent(summary.name)}&scope=${summary.scope}`)
      setDraft({
        name: body.name,
        description: body.description,
        whenToUse: body.whenToUse ?? '',
        scope: body.scope,
        modelInvocable: body.modelInvocable,
        userInvocable: body.userInvocable,
        content: body.content,
        originalName: body.name,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('error.load'))
    }
  }

  const save = async () => {
    if (draft === null) return
    if (!SKILL_NAME_RE.test(draft.name)) {
      setFormError(t('error.invalidName'))
      return
    }
    if (draft.description.trim() === '') {
      setFormError(t('field.description'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload: SkillWriteRequest = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        whenToUse: draft.whenToUse.trim() || undefined,
        scope: draft.scope,
        modelInvocable: draft.modelInvocable,
        userInvocable: draft.userInvocable,
        content: draft.content,
      }
      await fetchJson('/skill-manager/write', { method: 'POST', body: JSON.stringify(payload) })
      setDraft(null)
      setStatus(t('status.saved'))
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('error.save'))
    } finally {
      setSaving(false)
    }
  }

  const confirmRemove = async () => {
    if (confirmTarget === null) return
    try {
      await fetchJson('/skill-manager/remove', {
        method: 'POST',
        body: JSON.stringify({ name: confirmTarget.name, scope: confirmTarget.scope }),
      })
      setConfirmTarget(null)
      setStatus(t('status.deleted'))
      await load()
    } catch (error) {
      setConfirmTarget(null)
      setStatus(error instanceof Error ? error.message : t('error.delete'))
    }
  }

  const onQuery = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)

  const setDraftField = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }))
  }

  return h(Fragment, null,
    h('div', { className: css.root },
      h('div', { className: css.header },
        h('div', null,
          h('h2', { className: css.title }, t('title')),
          h('p', { className: css.subtitle }, t('subtitle')),
        ),
        h(Button, { variant: 'primary', icon: h(IconPlusOutline16), onClick: openNew }, t('action.create')),
      ),

      status !== null && h('p', { className: css.status }, status),

      h('div', { className: css.toolbar },
        h(Input, { className: css.search, icon: h(IconSearchOutline16), placeholder: t('search.placeholder'), value: query, onChange: onQuery }),
      ),

      loading
        ? h('p', { className: css.muted }, t('status.loading'))
        : loadError !== null
          ? h('p', { className: css.error }, `${t('error.load')}: ${loadError}`)
          : filtered.length === 0
            ? h('p', { className: css.muted }, t('list.empty'))
            : h('ul', { className: css.list },
                filtered.map((skill) => h('li', { className: css.row, key: `${skill.scope}:${skill.name}` },
                  h(IconSkillOutline16, { className: css.rowIcon }),
                  h('div', { className: css.rowMain },
                    h('div', { className: css.rowTitle },
                      h('span', { className: css.rowName }, skill.name),
                      h('span', { className: css.scopeTag }, skill.scope === 'user' ? t('scope.user') : t('scope.project')),
                      skill.modelInvocable && h('span', { className: css.badge }, t('badge.model')),
                      skill.userInvocable && h('span', { className: css.badge }, t('badge.user')),
                    ),
                    h('p', { className: css.rowDesc }, skill.description),
                  ),
                  h('div', { className: css.rowActions },
                    h(Button, { size: 'sm', icon: h(IconEditOutline16), onClick: () => { void openEdit(skill) } }, t('action.edit')),
                    h(Button, { size: 'sm', icon: h(IconTrashOutline16), onClick: () => setConfirmTarget(skill) }, t('action.delete')),
                  ),
                )),
              ),
    ),

    draft !== null && h(Modal, {
      open: true,
      onClose: () => { setDraft(null); setFormError(null) },
      title: draft.originalName === undefined ? t('editor.newTitle') : t('editor.editTitle'),
      footer: h(Fragment, null,
        h(Button, { onClick: () => { setDraft(null); setFormError(null) } }, t('action.cancel')),
        h(Button, { variant: 'primary', disabled: saving, onClick: () => { void save() } }, t('action.save')),
      ),
    },
      h('div', { className: css.form },
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.name')),
          h(Input, { value: draft.name, disabled: draft.originalName !== undefined, onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftField('name', event.target.value) }),
          h('span', { className: css.hint }, t('field.name.hint')),
        ),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.description')),
          h(Input, { value: draft.description, onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftField('description', event.target.value) }),
          h('span', { className: css.hint }, t('field.description.hint')),
        ),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.whenToUse')),
          h(Input, { value: draft.whenToUse, onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftField('whenToUse', event.target.value) }),
        ),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.scope')),
          h('select', { className: css.select, value: draft.scope, onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraftField('scope', event.target.value as SkillScope) },
            h('option', { value: 'user' }, t('scope.user')),
            h('option', { value: 'project' }, t('scope.project')),
          ),
        ),
        h('div', { className: css.fieldRow },
          h('label', { className: css.check },
            h('input', { type: 'checkbox', checked: draft.modelInvocable, onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftField('modelInvocable', event.target.checked) }),
            h('span', null, t('field.modelInvocable')),
          ),
          h('label', { className: css.check },
            h('input', { type: 'checkbox', checked: draft.userInvocable, onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftField('userInvocable', event.target.checked) }),
            h('span', null, t('field.userInvocable')),
          ),
        ),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.content')),
          h('textarea', { className: css.textarea, value: draft.content, placeholder: t('field.content.placeholder'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraftField('content', event.target.value) }),
        ),
        formError !== null && h('p', { className: css.error }, formError),
      ),
    ),

    confirmTarget !== null && h(Modal, {
      open: true,
      onClose: () => setConfirmTarget(null),
      title: t('confirm.deleteTitle'),
      footer: h(Fragment, null,
        h(Button, { onClick: () => setConfirmTarget(null) }, t('action.cancel')),
        h(Button, { variant: 'primary', onClick: () => { void confirmRemove() } }, t('action.confirm')),
      ),
    },
      h('p', null, t('confirm.deleteBody').replace('{name}', confirmTarget.name)),
    ),
  )
}
