/**
 * Skill manager settings section: lists managed skills (catalog-style, matching
 * the DSH Plugins → Plugin list layout), and provides create / edit / delete /
 * ZIP-import flows backed by the host HTTP routes under `/skill-manager`.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { createElement as h, Fragment } from 'react'
import {
  Button, Input, Modal, Pill,
  IconPlusOutline16, IconEditOutline16, IconTrashOutline16, IconSearchOutline16, IconDownloadOutline16, IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  SKILL_NAME_RE, type SkillBody, type SkillSummary, type SkillTarget, type SkillWriteRequest, type WorkspaceInfo,
} from '../types.ts'
import type { Translate } from './locales.ts'
import css from './SkillManager.module.css'

type ScopeFilter = 'all' | 'user' | 'workspace'

interface SkillDraft {
  name: string
  description: string
  whenToUse: string
  modelInvocable: boolean
  userInvocable: boolean
  content: string
  originalName?: string
  /** Previous location of the instance being edited; removed when not re-targeted. */
  originalTarget?: SkillTarget
  /** Install locations (global, or one or more workspaces — never mixed). */
  targets: SkillTarget[]
}

const EMPTY_DRAFT: SkillDraft = {
  name: '',
  description: '',
  whenToUse: '',
  modelInvocable: true,
  userInvocable: true,
  content: '',
  targets: [{ scope: 'user' }],
}

/** Global is exclusive; workspaces are multi-select. */
function toggleLocation(current: readonly SkillTarget[], next: SkillTarget): SkillTarget[] {
  if (next.scope === 'user') {
    return current.some((target) => target.scope === 'user') ? [] : [{ scope: 'user' }]
  }
  const workspaces = current.filter((target) => target.scope === 'workspace')
  const exists = workspaces.some((target) => target.workspacePath === next.workspacePath)
  if (exists) return workspaces.filter((target) => target.workspacePath !== next.workspacePath)
  return [...workspaces, next]
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

function basenameOf(path: string | undefined): string {
  if (path === undefined) return ''
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function SkillManager({ t }: { t: Translate }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ScopeFilter>('all')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SkillSummary | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // ZIP import state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importTargets, setImportTargets] = useState<SkillTarget[]>([{ scope: 'user' }])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [skillsData, workspacesData] = await Promise.all([
        fetchJson<{ skills: SkillSummary[] }>('/skill-manager/list'),
        fetchJson<{ workspaces: WorkspaceInfo[] }>('/skill-manager/workspaces'),
      ])
      setSkills(skillsData.skills)
      setWorkspaces(workspacesData.workspaces)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('error.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return skills.filter((skill) => {
      if (filter === 'user' && skill.scope !== 'user') return false
      if (filter === 'workspace' && skill.scope !== 'workspace') return false
      if (needle !== '') {
        return skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
      }
      return true
    })
  }, [skills, query, filter])

  const locationLabel = useCallback((target: SkillTarget): string => {
    if (target.scope === 'user') return t('scope.user')
    const workspace = workspaces.find((entry) => entry.path === target.workspacePath)
    return workspace?.title ?? basenameOf(target.workspacePath)
  }, [workspaces, t])

  const targetOf = (summary: SkillSummary): SkillTarget => (
    summary.scope === 'workspace'
      ? { scope: 'workspace', workspacePath: summary.workspacePath }
      : { scope: 'user' }
  )

  const rowKey = (summary: SkillSummary): string => `${summary.scope}:${summary.workspacePath ?? ''}:${summary.name}`

  const openNew = () => {
    setFormError(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  const openEdit = async (summary: SkillSummary) => {
    setFormError(null)
    const target = targetOf(summary)
    const params = new URLSearchParams({ name: summary.name, scope: summary.scope })
    if (summary.workspacePath !== undefined) params.set('workspace', summary.workspacePath)
    try {
      const body = await fetchJson<SkillBody>(`/skill-manager/read?${params.toString()}`)
      setDraft({
        name: body.name,
        description: body.description,
        whenToUse: body.whenToUse ?? '',
        modelInvocable: body.modelInvocable,
        userInvocable: body.userInvocable,
        content: body.content,
        originalName: body.name,
        originalTarget: target,
        targets: [target],
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
    if (draft.targets.length === 0) {
      setFormError(t('import.noLocation'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload: SkillWriteRequest = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        whenToUse: draft.whenToUse.trim() || undefined,
        modelInvocable: draft.modelInvocable,
        userInvocable: draft.userInvocable,
        content: draft.content,
        targets: draft.targets,
        previousTarget: draft.originalTarget,
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
        body: JSON.stringify({ name: confirmTarget.name, target: targetOf(confirmTarget) }),
      })
      setConfirmTarget(null)
      setStatus(t('status.deleted'))
      await load()
    } catch (error) {
      setConfirmTarget(null)
      setStatus(error instanceof Error ? error.message : t('error.delete'))
    }
  }

  const runImport = async () => {
    if (importFile === null) {
      setImportError(t('import.noFile'))
      return
    }
    if (importTargets.length === 0) {
      setImportError(t('import.noLocation'))
      return
    }
    setImporting(true)
    setImportError(null)
    try {
      const bytes = new Uint8Array(await importFile.arrayBuffer())
      let total = 0
      for (const target of importTargets) {
        const params = new URLSearchParams({ scope: target.scope })
        if (target.workspacePath !== undefined) params.set('workspace', target.workspacePath)
        const result = await fetchJson<{ imported: string[] }>(`/skill-manager/import?${params.toString()}`, {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: bytes,
        })
        total += result.imported.length
      }
      setImportOpen(false)
      setImportFile(null)
      setImportTargets([{ scope: 'user' }])
      setStatus(t('status.imported').replace('{n}', String(total)))
      await load()
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('error.import'))
    } finally {
      setImporting(false)
    }
  }

  const onQuery = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)

  const setDraftField = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }))
  }

  const locationPills = (targets: readonly SkillTarget[], onTargets: (next: SkillTarget[]) => void) => h(Fragment, null,
    h(Pill, { active: targets.some((target) => target.scope === 'user'), onClick: () => onTargets(toggleLocation(targets, { scope: 'user' })) }, t('location.user')),
    workspaces.length > 0 && h('span', { className: css.groupLabel }, t('location.workspaces')),
    workspaces.map((workspace) => h(Pill, {
      key: workspace.id,
      active: targets.some((target) => target.scope === 'workspace' && target.workspacePath === workspace.path),
      onClick: () => onTargets(toggleLocation(targets, { scope: 'workspace', workspacePath: workspace.path })),
    }, workspace.title)),
    workspaces.length === 0 && h('p', { className: css.muted }, t('location.empty')),
  )

  const flagToggles = (modelInvocable: boolean, userInvocable: boolean, onModel: (v: boolean) => void, onUser: (v: boolean) => void) => h('div', { className: css.pillGroup },
    h(Pill, { active: modelInvocable, onClick: () => onModel(!modelInvocable) }, t('field.modelInvocable')),
    h(Pill, { active: userInvocable, onClick: () => onUser(!userInvocable) }, t('field.userInvocable')),
  )

  return h(Fragment, null,
    h('div', { className: css.root },
      h('div', { className: css.header },
        h('div', { className: css.headerText },
          h('h2', { className: css.title }, t('title')),
          h('p', { className: css.subtitle }, t('subtitle')),
        ),
        h('div', { className: css.headerActions },
          h(Button, { className: css.headerButton, variant: 'outline', icon: h(IconDownloadOutline16), onClick: () => { setImportError(null); setImportOpen(true) } }, t('action.import')),
          h(Button, { className: css.headerButton, variant: 'primary', icon: h(IconPlusOutline16), onClick: openNew }, t('action.create')),
        ),
      ),

      status !== null && h('p', { className: css.status }, status),

      h('div', { className: css.catalog },
        h('label', { className: css.search },
          h(IconSearchOutline16),
          h('span', { className: css.visuallyHidden }, t('search.placeholder')),
          h('input', { type: 'search', value: query, placeholder: t('search.placeholder'), 'aria-label': t('search.placeholder'), onChange: onQuery }),
        ),
        h('div', { className: css.pillGroup },
          h(Pill, { active: filter === 'all', onClick: () => setFilter('all') }, t('filter.all')),
          h(Pill, { active: filter === 'user', onClick: () => setFilter('user') }, t('filter.user')),
          h(Pill, { active: filter === 'workspace', onClick: () => setFilter('workspace') }, t('filter.workspace')),
        ),
        h('div', { className: css.catalogHeading },
          h('h3', null, t('catalog')),
          h('span', { 'data-skill-count': filtered.length }, String(filtered.length)),
        ),
        loading
          ? h('p', { className: css.statusText }, t('status.loading'))
          : loadError !== null
            ? h('p', { className: css.error }, `${t('error.load')}: ${loadError}`)
            : filtered.length === 0
              ? h('p', { className: css.statusText }, t('list.empty'))
              : h('ul', { className: css.cards },
                  filtered.map((skill) => {
                    const open = expandedKey === rowKey(skill)
                    const location = locationLabel(targetOf(skill))
                    return h('li', { className: css.card, key: rowKey(skill), 'data-open': open ? 'true' : undefined },
                      h('button', {
                        className: css.cardContent,
                        type: 'button',
                        'aria-expanded': open,
                        onClick: () => setExpandedKey(open ? null : rowKey(skill)),
                      },
                        h('strong', { className: css.cardTitle, title: skill.name }, skill.name),
                        h('span', { className: css.cardTrailing },
                          h('span', { className: css.statusDot, 'data-scope': skill.scope, role: 'img', 'aria-label': location, title: location }),
                          h('span', { className: css.configTag, 'data-enabled': skill.scope === 'user' ? 'true' : 'false' }, location),
                          h(IconChevronDownOutline14, { className: css.chevron, size: 12 }),
                        ),
                      ),
                      open ? h('div', { className: css.cardDetails },
                        h('p', { className: css.rowDesc }, skill.description),
                        h('dl', { className: css.details },
                          h('div', null,
                            h('dt', null, t('field.location')),
                            h('dd', null, location),
                          ),
                          h('div', null,
                            h('dt', null, t('field.modelInvocable')),
                            h('dd', null, skill.modelInvocable ? t('badge.model') : '—'),
                          ),
                          h('div', null,
                            h('dt', null, t('field.userInvocable')),
                            h('dd', null, skill.userInvocable ? t('badge.user') : '—'),
                          ),
                        ),
                        h('div', { className: css.rowActions },
                          h(Button, { size: 'sm', icon: h(IconEditOutline16), onClick: () => { void openEdit(skill) } }, t('action.edit')),
                          h(Button, { size: 'sm', icon: h(IconTrashOutline16), onClick: () => setConfirmTarget(skill) }, t('action.delete')),
                        ),
                      ) : null,
                    )
                  }),
                ),
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
        h('div', { className: css.field },
          h('span', { className: css.label }, t('field.location')),
          h('div', { className: css.pillGroup }, locationPills(draft.targets, (next) => setDraftField('targets', next))),
          h('span', { className: css.hint }, t('field.location.hint')),
        ),
        h('div', { className: css.field },
          h('span', { className: css.label }, t('field.modelInvocable')),
          flagToggles(
            draft.modelInvocable,
            draft.userInvocable,
            (value) => setDraftField('modelInvocable', value),
            (value) => setDraftField('userInvocable', value),
          ),
        ),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('field.content')),
          h('textarea', { className: css.textarea, value: draft.content, placeholder: t('field.content.placeholder'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraftField('content', event.target.value) }),
        ),
        formError !== null && h('p', { className: css.error }, formError),
      ),
    ),

    importOpen && h(Modal, {
      open: true,
      onClose: () => { setImportOpen(false); setImportFile(null); setImportError(null) },
      title: t('import.title'),
      footer: h(Fragment, null,
        h(Button, { onClick: () => { setImportOpen(false); setImportFile(null); setImportError(null) } }, t('action.cancel')),
        h(Button, { variant: 'primary', disabled: importing, onClick: () => { void runImport() } }, t('action.import')),
      ),
    },
      h('div', { className: css.form },
        h('p', { className: css.muted }, t('import.hint')),
        h('label', { className: css.field },
          h('span', { className: css.label }, t('import.file')),
          h('input', { type: 'file', accept: '.zip,application/zip', className: css.fileInput, onChange: (event: ChangeEvent<HTMLInputElement>) => setImportFile(event.target.files?.[0] ?? null) }),
        ),
        h('div', { className: css.field },
          h('span', { className: css.label }, t('field.location')),
          h('div', { className: css.pillGroup }, locationPills(importTargets, setImportTargets)),
        ),
        importError !== null && h('p', { className: css.error }, importError),
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
