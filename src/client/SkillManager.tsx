/**
 * Skill manager settings section: lists managed skills, and provides
 * create / edit / delete / ZIP-import flows backed by the host HTTP routes
 * under `/skill-manager`.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { createElement as h, Fragment } from 'react'
import {
  Button, Input, Modal, Pill,
  IconPlusOutline16, IconEditOutline16, IconTrashOutline16, IconSkillOutline16, IconSearchOutline16, IconDownloadOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  SKILL_NAME_RE, type SkillBody, type SkillSummary, type SkillTarget, type SkillWriteRequest, type WorkspaceInfo,
} from '../types.ts'
import type { Translate } from './locales.ts'
import css from './SkillManager.module.css'

interface SkillDraft {
  name: string
  description: string
  whenToUse: string
  modelInvocable: boolean
  userInvocable: boolean
  content: string
  originalName?: string
  /** Previous location when editing; a different `target` on save moves the skill. */
  originalTarget?: SkillTarget
  /** The single install location. */
  target: SkillTarget
}

const EMPTY_DRAFT: SkillDraft = {
  name: '',
  description: '',
  whenToUse: '',
  modelInvocable: true,
  userInvocable: true,
  content: '',
  target: { scope: 'user' },
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
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SkillSummary | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // ZIP import state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importTarget, setImportTarget] = useState<SkillTarget>({ scope: 'user' })
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
    if (needle === '') return skills
    return skills.filter((skill) => (
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
    ))
  }, [skills, query])

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
        target,
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
        modelInvocable: draft.modelInvocable,
        userInvocable: draft.userInvocable,
        content: draft.content,
        target: draft.target,
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
    setImporting(true)
    setImportError(null)
    try {
      const bytes = new Uint8Array(await importFile.arrayBuffer())
      const params = new URLSearchParams({ scope: importTarget.scope })
      if (importTarget.workspacePath !== undefined) params.set('workspace', importTarget.workspacePath)
      const result = await fetchJson<{ imported: string[] }>(`/skill-manager/import?${params.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: bytes,
      })
      setImportOpen(false)
      setImportFile(null)
      setImportTarget({ scope: 'user' })
      setStatus(t('status.imported').replace('{n}', String(result.imported.length)))
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

  const locationPills = (target: SkillTarget, onTarget: (next: SkillTarget) => void) => h(Fragment, null,
    h(Pill, { active: target.scope === 'user', onClick: () => onTarget({ scope: 'user' }) }, t('location.user')),
    workspaces.length > 0 && h('span', { className: css.groupLabel }, t('location.workspaces')),
    workspaces.map((workspace) => h(Pill, {
      key: workspace.id,
      active: target.scope === 'workspace' && target.workspacePath === workspace.path,
      onClick: () => onTarget({ scope: 'workspace', workspacePath: workspace.path }),
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
                filtered.map((skill) => h('li', { className: css.row, key: `${skill.scope}:${skill.workspacePath ?? ''}:${skill.name}` },
                  h(IconSkillOutline16, { className: css.rowIcon }),
                  h('div', { className: css.rowMain },
                    h('div', { className: css.rowTitle },
                      h('span', { className: css.rowName }, skill.name),
                      h('span', { className: css.scopeTag }, locationLabel(targetOf(skill))),
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
        h('div', { className: css.field },
          h('span', { className: css.label }, t('field.location')),
          h('div', { className: css.pillGroup }, locationPills(draft.target, (next) => setDraftField('target', next))),
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
          h('div', { className: css.pillGroup }, locationPills(importTarget, setImportTarget)),
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
