# Architecture

`dsh-skill-manager` is a single dual-face out-of-tree bundle: one npm package that contributes both a host plugin and a browser settings section. It follows the same shape as other external DSH plugins (e.g. `dshmarket`).

```
Browser (settings → Skills)                    Host (Node)
┌──────────────────────────────┐   fetch   ┌──────────────────────────────┐
│ client/client.js             │ ────────► │ webServer.register(...)      │
│  SkillManager.tsx (React)    │  /skill-  │  routes.ts                   │
│  locales.ts (zh/en)          │  manager  │  skills.ts (SkillStore)      │
└──────────────────────────────┘           │  http.ts (guards)            │
                                           └──────────────┬───────────────┘
                                                          │ fs
                                           ┌──────────────▼───────────────┐
                                           │ $DSH_HOME/skills  (user)     │
                                           │ <cwd>/.dsh/skills (project)  │
                                           └──────────────────────────────┘
```

## Composition

`cordis.patch.yml` inserts a single host row:

```yaml
- insert:
    - id: dsh-skill-manager
      name: 'dsh-skill-manager'
```

The package manifest carries two declarations:

- `dsh.bundle.patch` → makes the row a composable patch layer (so `dsh plugin add` reconciles it into `dsh.profile.bundles`).
- `dsh.client` → tells the host's client-module system to serve the browser bundle (`exports["./client"]`) and mount it beside the shipped client roster.

The host row resolves to `lib/index.js`, whose `apply` waits for `webServer` (`ctx.inject(['webServer'], …)`) and registers the routes once it exists. The browser half is served and mounted independently because the package declares `dsh.client`.

## Wire protocol

All routes live under the `/skill-manager` prefix. Requests and responses are JSON with `cache-control: no-store`.

| Method | Path | Body / query | Effect |
|---|---|---|---|
| `GET` | `/skill-manager/list` | — | Returns `{ skills: SkillSummary[] }` across both scopes, sorted by name. |
| `GET` | `/skill-manager/read` | `?name=&scope=` | Returns one `SkillBody` (frontmatter + body), or `404`. |
| `POST` | `/skill-manager/write` | `SkillWriteRequest` | Creates or updates a skill; returns the new `SkillSummary`. |
| `POST` | `/skill-manager/remove` | `{ name, scope }` | Deletes a skill; returns `{ removed }`. |

Types are defined once in `src/types.ts` and shared by both sides (the client inlines them into its bundle).

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
- **No secrets**: skill files are user-authored instructions; the plugin never reads credentials or environment variables and never uploads anything.

## Client bundle build

`tsdown.config.ts` emits `client/client.js` as a `window.__ModuleLoader__.load({ id, factory })` closure. Only `react`, `react/jsx-runtime`, and `@deepseek-ai/dsh-client-ui-primitives` are externalized (resolved from the loader module table); everything else — including `src/types.ts`, `locales.ts`, and the CSS module — is inlined. CSS Modules compile via lightningcss and inject a plugin-owned `<style data-plugin>` tag at factory execution.

`scripts/preflight.mjs` asserts the emitted bundle still carries the exact banner, so a silent wrapper regression fails CI.
