# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

### Added

- Initial release.
- Host plugin mounting `/skill-manager` HTTP routes on the composed `webServer`.
- `SkillStore` filesystem service: list / read / write / remove `SKILL.md` directory bundles under `user` and `project` scopes.
- Browser settings section with create / edit / delete flows, search, and scope + invocation toggles.
- Loopback + same-origin guards on mutating routes.
- Bilingual UI (zh / en).
- CI (typecheck + unit tests + build + bundle-banner preflight) on Ubuntu and Windows, and a tag-driven npm release workflow.
