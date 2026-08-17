# dsh-skill-manager

[中文](README.zh.md) | English

Graphical **skill manager** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Create, edit, and delete `SKILL.md` skills from the Web settings UI — no terminal, no hand-edited YAML frontmatter.

| | |
|---|---|
| npm | `dsh-skill-manager` |
| Category | `dsh-plugin` |
| License | [MIT](LICENSE) |

## Features

- **List** managed skills with their description, scope, and invocation flags.
- **Create** a new skill through a form: name (kebab-case), description, optional `whenToUse`, scope, model/user invocation toggles, and the Markdown instruction body.
- **Edit** an existing skill (the name is immutable while editing — rename by recreating).
- **Delete** with a confirmation step.
- **Two scopes**: `user` (machine-global, `$DSH_HOME/skills`) and `project` (workspace-local, `<cwd>/.dsh/skills`) — the same roots the built-in `skill-filesystem` provider already scans, so anything you write is picked up by the harness without a restart.
- Bilingual (中文 / English) and theme-aware, rendered with the native DSH UI primitives.

## Install

```sh
dsh plugin --profile web add dsh-skill-manager
```

Restart `dsh web`, then open **Settings → Skills**.

> Git-hosted installs run the package's `prepare` build script, which pnpm ≥ 10 blocks until you allow it. Copy the key pnpm prints into the profile's `pnpm-workspace.yaml` `allowBuilds` and re-run. Installing from npm or a tarball needs no allowance.

## Usage

1. Open **Settings → Skills**.
2. Click **New skill**, fill in the form, and **Save**.
3. The skill lands as a directory bundle:

   ```
   $DSH_HOME/skills/<name>/SKILL.md        # scope: user
   <workspace>/.dsh/skills/<name>/SKILL.md # scope: project
   ```

4. The built-in skill discovery picks it up on the next pass — the model can then load it via the `skill` tool, and the `/`-trigger menu offers it for user invocation.

## How it works

The package is a single dual-face bundle (host + browser), following the standard out-of-tree plugin shape:

- **Host** (`src/index.ts`) injects `webServer` and registers HTTP routes under `/skill-manager` that read and write `SKILL.md` bundles.
- **Browser** (`src/client/`) registers a `settings.section` and drives the routes with `fetch`.

See [docs/architecture.md](docs/architecture.md) for the wire protocol, security model, and directory layout.

## Security

Mutating routes (`write`, `remove`) write files with the host user's permissions, so they are **loopback-pinned and same-origin only** — the same boundary the harness uses for its own privileged operations. Read routes (`list`, `read`) are read-only.

## Development

Requires Node.js 22.19+ (24 recommended) and npm.

```sh
npm install        # also runs `prepare` → build
npm run typecheck  # tsc on host + client
npm test           # vitest unit tests (host skill store)
npm run build      # tsc (host lib/) + tsdown (client/client.js)
```

## Project structure

```
src/
  index.ts               host entry: mounts HTTP routes on webServer
  routes.ts              /skill-manager route dispatch
  skills.ts              SKILL.md filesystem service (list/read/write/remove)
  http.ts                JSON + same-origin + loopback helpers
  types.ts               shared wire types
  client/
    index.ts             client entry: settings.section registration
    SkillManager.tsx     the React settings UI
    SkillManager.module.css
    locales.ts           zh / en
cordis.patch.yml         bundle patch layer
tsdown.config.ts         client bundle build (__ModuleLoader__ factory)
.github/workflows/       ci.yml + release.yml
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
