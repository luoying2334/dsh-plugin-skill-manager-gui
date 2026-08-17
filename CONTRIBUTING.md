# Contributing

Thanks for helping out! This is a small, focused plugin, so the bar is low — but please keep the invariants below.

## Ground rules

- **Never commit build artifacts.** `lib/`, `client/`, and `node_modules/` are gitignored; they are produced by `npm run build` and published by CI. PRs should only change `src/`, `tests/`, config, and docs.
- **Keep the host/client split.** Host code (`src/` outside `src/client`) runs in Node; browser code (`src/client`) runs in the page. Do not import Node built-ins from client code, and keep `src/types.ts` free of runtime dependencies so both sides can share it.
- **Mutating routes stay loopback + same-origin.** Any new `POST` route that writes to disk must go through `assertLocalMutation` in `src/http.ts`.
- **Skill files follow the DSH format.** Names are kebab-case; a skill is a directory bundle `<root>/<name>/SKILL.md` with `name` and `description` frontmatter. See `packages/skill/skill-filesystem/README.md` in the main repository for the exact contract.

## Local development

```sh
npm install
npm run typecheck
npm test
npm run build
```

`npm run check` runs all of the above in order.

## Conventions

- TypeScript `strict: true`. Every module and non-obvious export has a concise JSDoc comment.
- Strings are localized through `src/client/locales.ts` (`zh` + `en`). UI copy never hardcodes user-facing text.
- Tests live in `tests/` and run under Vitest with the Node environment. Client UI tests (jsdom) are welcome but not required for a first contribution.

## PR checklist

1. `npm run check` passes.
2. New behavior is covered by a test where practical.
3. `README.md` (default, 中文) / `README.en.md` updated if the user-facing behavior changed.
4. Commit messages are clear and self-contained.

## Release

Releases are tag-driven: push a `vX.Y.Z` tag whose version matches `package.json`. The [release workflow](.github/workflows/release.yml) builds, verifies, publishes to npm, and creates a GitHub release. Only maintainers should push version tags.
