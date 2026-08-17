# Architecture

`dsh-plugin-skill-manager-gui` is a single dual-face out-of-tree bundle: one npm package that contributes both a host plugin and a browser settings section. It follows the same shape as other external DSH plugins (e.g. `dshmarket`).

```
Browser (settings → Skills)                 Host (Node)
┌──────────────────────────────┐   fetch   ┌──────────────────────────────┐
│ client/client.js             │ ────────► │ webServer.register(...)      │
│  SkillManager.tsx (React)    │  /skill-  │  routes.ts                   │
│  locales.ts (zh/en)          │  manager  │  skills.ts (SkillStore)      │
└──────────────────────────────┘           │  import.ts (ZIP)             │
                                           │  http.ts (guards)            │
                                           └──────────────┬───────────────┘
                                                          │ fs
                                           ┌──────────────▼───────────────┐
                                           │ $DSH_HOME/skills  (global)    │
                                           │ <workspace>/.dsh/skills (ws)  │
                                           └──────────────────────────────┘
```

## Composition

`cordis.patch.yml` inserts a single host row:

```yaml
- insert:
    - id: dsh-plugin-skill-manager-gui
      name: 'dsh-plugin-skill-manager-gui'
```

The package manifest carries two declarations:

- `dsh.bundle.patch` → makes the row a composable patch layer (so `dsh plugin add` reconciles it into `dsh.profile.bundles`).
- `dsh.client` → tells the host's client-module system to serve the browser bundle (`exports["./client"]`) and mount it beside the shipped client roster.

The host row resolves to `lib/index.js`, whose `apply` waits for `webServer` + `workspaceRegistry` (`ctx.inject(['webServer', 'workspaceRegistry'], …)`) and registers the routes once they exist. The browser half is served and mounted independently because the package declares `dsh.client`.

## Wire protocol

All routes live under the `/skill-manager` prefix. Requests and responses are JSON with `cache-control: no-store`; the import route carries a raw ZIP body.

| Method | Path | Body / query | Effect |
|---|---|---|---|
| `GET` | `/skill-manager/list` | — | Returns `{ skills: SkillSummary[] }` across the global root and every workspace root. |
| `GET` | `/skill-manager/workspaces` | — | Returns `{ workspaces: WorkspaceInfo[] }` from `workspaceRegistry.list()`. |
| `GET` | `/skill-manager/read` | `?name=&scope=&workspace=` | Returns one `SkillBody` (frontmatter + body), or `404`. |
| `POST` | `/skill-manager/write` | `SkillWriteRequest` (with `targets[]`) | Creates or updates a skill in every target; returns the new summaries. |
| `POST` | `/skill-manager/remove` | `{ name, target }` | Deletes a skill from one target; returns `{ removed }`. |
| `POST` | `/skill-manager/import` | `?scope=&workspace=` + ZIP body | Extracts the zip into one target; returns `{ imported }`. |

A `target` is `{ scope: 'user' }` or `{ scope: 'workspace', workspacePath }`. Types are defined once in `src/types.ts` and shared by both sides (the client inlines them into its bundle).

## Skill file format

A skill is written as a directory bundle so it can later carry `references/`, `scripts/`, or `assets/`:

```
<root>/<name>/SKILL.md
```

`SKILL.md` frontmatter (written by `SkillStore`):

```yaml
name: code-review
description: Review code for bugs
whenToUse: ...            # optional
disable-model-invocation: false
user-invocable: true
```

Invocation flags mirror the DSH `skill-filesystem` contract: `modelInvocable: false` maps to `disable-model-invocation: true`, and `userInvocable: false` maps to `user-invocable: false`.

## Security model

- **Mutating routes are loopback + same-origin only** (`assertLocalMutation`): the socket peer must be `127.0.0.1`/`::1` and the `Origin` must match the `Host`. This prevents a LAN client admitted by `--trusted-host`, or a cross-site page, from writing skill files with the host user's permissions.
- **Read routes are read-only** and sit inside the same browser-trust boundary as the rest of the web surface.
- **Names are validated** (`kebab-case`) and descriptions required, both in the client (non-authoritative) and in `SkillStore` (authoritative).
- **ZIP import sanitizes every entry path** (`safeEntryParts`): `..`, absolute paths, and empty paths are rejected before any file is written.
- **No secrets**: skill files are user-authored instructions; the plugin never reads credentials or environment variables and never uploads anything.

## Client bundle build

`tsdown.config.ts` emits `client/client.js` as a `window.__ModuleLoader__.load({ id, factory })` closure. Only `react`, `react/jsx-runtime`, and `@deepseek-ai/dsh-client-ui-primitives` are externalized (resolved from the loader module table); everything else — including `src/types.ts`, `locales.ts`, and the CSS module — is inlined. CSS Modules compile via lightningcss and inject a plugin-owned `<style data-plugin>` tag at factory execution.

`scripts/preflight.mjs` asserts the emitted bundle still carries the exact banner, so a silent wrapper regression fails CI.
