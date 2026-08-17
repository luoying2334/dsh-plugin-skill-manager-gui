# dsh-plugin-skill-manager-gui

[涓枃](README.zh.md) | English

Graphical **skill manager** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Create, edit, import, and delete `SKILL.md` skills from the Web settings UI 鈥?no terminal, no hand-edited YAML frontmatter.

| | |
|---|---|
| npm | `dsh-plugin-skill-manager-gui` |
| Category | `dsh-plugin` |
| License | [MIT](LICENSE) |

## Features

- **List** managed skills with their description, location, and invocation flags.
- **Create** a new skill through a form: name (kebab-case), description, optional `whenToUse`, install location, model/user invocation toggles, and the Markdown instruction body.
- **Edit** an existing skill (the name is immutable while editing 鈥?rename by recreating).
- **Delete** with a confirmation step.
- **Import a ZIP** of skills (`<name>/SKILL.md` or `<name>.md`, plus nested resources) into one or more locations.
- **Global + workspaces**: install to the machine-global root (`$DSH_HOME/skills`) and/or tick any of the workspaces the harness already tracks (`<workspace>/.dsh/skills`) 鈥?the same roots the built-in `skill-filesystem` provider scans, so anything you write is picked up without a restart.
- Bilingual (涓枃 / English) and theme-aware, rendered with the native DSH UI primitives.

## Install

```sh
dsh plugin --profile web add dsh-plugin-skill-manager-gui
```

Restart `dsh web`, then open **Settings 鈫?Skills**.

> Git-hosted installs run the package's `prepare` build script, which pnpm 鈮?10 blocks until you allow it. Copy the key pnpm prints into the profile's `pnpm-workspace.yaml` `allowBuilds` and re-run. Installing from npm or a tarball needs no allowance.

## Usage

1. Open **Settings 鈫?Skills**.
2. Click **New skill**, fill in the form, tick one or more install locations, and **Save**. Or click **Import ZIP** to bring in a batch of skills.
3. The skill lands as a directory bundle:

   ```
   $DSH_HOME/skills/<name>/SKILL.md          # global (user)
   <workspace>/.dsh/skills/<name>/SKILL.md   # one workspace
   ```

4. The built-in skill discovery picks it up on the next pass 鈥?the model can then load it via the `skill` tool, and the `/`-trigger menu offers it for user invocation.

## How it works

The package is a single dual-face bundle (host + browser), following the standard out-of-tree plugin shape:

- **Host** (`src/index.ts`) injects `webServer` + `workspaceRegistry` and registers HTTP routes under `/skill-manager` that read and write `SKILL.md` bundles.
- **Browser** (`src/client/`) registers a `settings.section` and drives the routes with `fetch`.

See [docs/architecture.md](docs/architecture.md) for the wire protocol, security model, and directory layout.

## Security

Mutating routes (`write`, `remove`, `import`) write files with the host user's permissions, so they are **loopback-pinned and same-origin only** 鈥?the same boundary the harness uses for its own privileged operations. Read routes (`list`, `read`, `workspaces`) are read-only. ZIP import sanitizes every entry path so no `..` or absolute path can escape the target root.

## Development

Requires Node.js 22.19+ (24 recommended) and npm.

```sh
npm install        # also runs `prepare` 鈫?build
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
  import.ts              ZIP import (safe extraction)
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
