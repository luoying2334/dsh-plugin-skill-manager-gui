# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

### Added

- Initial release.
- Host plugin mounting `/skill-manager` HTTP routes on the composed `webServer`, injecting `workspaceRegistry` to list real workspaces.
- `SkillStore` filesystem service: list / read / write / remove `SKILL.md` directory bundles under the global root and per-workspace roots.
- ZIP import (`<name>/SKILL.md`, `<name>.md`, plus nested resources) with path-traversal-safe extraction.
- Browser settings section with create / edit / delete flows, search, scope + invocation toggles, multi-location install (global + ticked workspaces), and a ZIP import dialog.
- Loopback + same-origin guards on mutating routes.
- Bilingual UI (zh / en).
- CI (typecheck + unit tests + build + bundle-banner preflight) on Ubuntu and Windows, and a tag-driven npm release workflow.

### Fixed

- Replaced the broken "current workspace" scope (host process cwd) with the harness's actual workspace registry.
- Replaced the native `<select>` scope dropdown with DSH-styled checkboxes.
- Prevented the "New skill" button label from wrapping.
