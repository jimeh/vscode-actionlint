# AGENTS.md

VS Code extension that lints GitHub Actions workflow files by spawning the
[actionlint](https://github.com/rhysd/actionlint) binary with stdin/JSON
output. No runtime dependencies.

## Commands

```bash
pnpm run compile          # type-check + lint + esbuild bundle
pnpm run check-types      # tsc --noEmit only
pnpm run lint             # oxlint + oxfmt --check
pnpm run lint:fix         # oxlint --fix + oxfmt --write
pnpm run format           # oxfmt (all files, uses ignorePatterns)
pnpm run test             # run full test suite (no single-file option)
pnpm run bundle           # production build (minified)
pnpm run package          # production build + create .vsix
pnpm run vsce:ls          # production build + list vsix contents
pnpm run verify:vsix-files # check .vsix contains expected files
```

Tests require compilation first: `pnpm run compile-tests && pnpm run compile`.
They run inside VS Code via @vscode/test-electron.

**Pre-PR**: `pnpm run check-types && pnpm run lint`

## Code Style

- Conventional commits (feat:, fix:, refactor:, test:)

## TypeScript Style

Oxfmt enforces formatting (Prettier-compatible). Key rules:

- Double quotes, semicolons
- Trailing commas in multi-line constructs (es5)
- 80 char print width
- 2-space indentation

**Always run `pnpm run format` after writing/editing TypeScript files
and before running `pnpm run compile` or `pnpm run test`.** The
`compile` task includes an oxfmt check that will fail on unformatted
code.

## Architecture

**Core flow**: document event → ActionlintLinter → runActionlint (execFile
with stdin) → toDiagnostics (1-based → 0-based coordinates) → VS Code
diagnostics collection.

**Concurrency**: per-document operation ID counters + AbortControllers.
New lint aborts the previous one; stale results are discarded by comparing
operation IDs. Grep for `operationIds`, `abortControllers` in the linter.

**Key patterns to grep**:

- `ActionlintLinter` — orchestrator, event listeners, per-document state
- `runActionlint` — child_process exec, stdin piping, JSON parsing
- `toDiagnostics` — coordinate conversion (end_column: 1-based inclusive →
  0-based exclusive, no adjustment needed)
- `getConfig` — reads `workspace.getConfiguration("actionlint")`
- `isWorkflowFile` — path matching for `.github/workflows/*.{yml,yaml}`

## CI/CD

GitHub Actions CI (`.github/workflows/ci.yml`) runs lint, check-types, test
(matrix: 1.95.0, 1.100.0, stable), and verify-vsix-files on every push.
Release-please creates release PRs on main. On version tags, package + publish
jobs deploy to VS Code Marketplace, Open VSX, and GitHub Releases.

`scripts/` directory is excluded from `tsconfig.json` (not under `src/`
rootDir). Scripts use `tsx` to run directly.

## Testing

Tests colocated in `src/test/`, fixtures in a `.github/workflows/` subtree.
Linter tests cover race conditions, stale result detection, abort signal
propagation, and dispose-during-inflight scenarios.

**Async test pattern**: use `waitFor()` from `src/test/helpers.ts` to poll
for expected state instead of fixed `sleep()` delays. This avoids flaky
tests caused by non-deterministic VS Code event timing (e.g.
`onDidChangeActiveTextEditor` after `showTextDocument`).

## Gotchas

- `actionlint -init-config` creates the config at the git root, not the CWD.
  Tests that need this command to target the fixture directory must run
  `git init` in the fixtures dir during setup (and `rm -rf .git` in teardown)
  so the fixture dir becomes its own git root.
