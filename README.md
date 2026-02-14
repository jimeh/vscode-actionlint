<div align="center">

<img width="196px" src="https://github.com/jimeh/vscode-actionlint/raw/refs/heads/main/img/logo.png" alt="Logo">

# actionlint for VS Code

Lint GitHub Actions workflow files using
[actionlint](https://github.com/rhysd/actionlint).

[![GitHub Release](https://img.shields.io/github/v/release/jimeh/vscode-actionlint?logo=github&label=Release)](https://github.com/jimeh/vscode-actionlint/releases/latest)
[![VSCode](https://img.shields.io/badge/Marketplace-blue.svg?logoColor=white&logo=data:image/svg%2bxml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMyIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtOTkuOTkgOS41NXY4My4zM3MtMjMuOCA5LjUxLTIzLjggOS41MWwtNDEuNjktNDAuNDYtMjUuMDIgMTkuMDUtOS40OC00Ljc1di01MHM5LjUzLTQuNzkgOS41My00Ljc5bDI1LjA0IDE5LjA2IDQxLjYtNDAuNSAyMy44MyA5LjU1em0tMjYuMjYgMjMuODgtMjMuOCAxNy43OSAyMy44MSAxNy45M3YtMzUuNzJ6bS02MS45NCA3LjA3djIxLjRzMTEuOS0xMC43NyAxMS45LTEwLjc3bC0xMS45MS0xMC42M3oiIGZpbGw9IiNmZmYiLz48L3N2Zz4=)][vscode-ext]
[![OpenVSX](https://img.shields.io/badge/OpenVSX-purple.svg?logoColor=white&logo=data:image/svg%2bxml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTMxIDEzMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSIjZmZmIj48cGF0aCBkPSJtNDIuOCA0My4zNSAyMi42LTM5LjJoLTQ1LjN6bS0yNS40IDQ0LjNoNDUuM2wtMjIuNy0zOS4xem01MSAwIDIyLjYgMzkuMiAyMi42LTM5LjJ6Ii8+PHBhdGggZD0ibTY1LjQgNC4xNS0yMi42IDM5LjJoNDUuMnptLTI1LjQgNDQuNCAyMi43IDM5LjEgMjIuNi0zOS4xem01MSAwLTIyLjYgMzkuMWg0NS4yeiIvPjwvZz48L3N2Zz4=)][openvsx-ext]
[![GitHub Issues](https://img.shields.io/github/issues/jimeh/vscode-actionlint?logo=github&label=Issues)](https://github.com/jimeh/vscode-actionlint/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/jimeh/vscode-actionlint?logo=github&label=PRs)](https://github.com/jimeh/vscode-actionlint/pulls)
[![License](https://img.shields.io/github/license/jimeh/vscode-actionlint?label=License)](https://github.com/jimeh/vscode-actionlint/blob/main/LICENSE)

</div>

A Visual Studio Code extension that provides inline diagnostics for GitHub
Actions workflow files. It runs [actionlint] against your workflow files and
surfaces errors directly in the editor as you work.

## Requirements

- **[actionlint]** must be installed and available on your `PATH` (or
  configured via `actionlint.executable`).
- **[shellcheck]** _(optional)_ — enables deeper lint checks for shell scripts
  in `run:` steps.
- **[pyflakes]** _(optional)_ — enables lint checks for Python scripts in
  `run:` steps.

## Getting Started

Install from the [VS Code Marketplace], [Open VSX], or via the CLI:

```sh
code --install-extension jimeh.actionlint
```

The extension activates automatically when a workspace contains a
`.github/workflows/` directory or when you open a GitHub Actions workflow file.

## Features

- Lint on save (default) or on type with configurable debounce.
- Regex-based error ignore patterns (`actionlint.ignoreErrors`).
- Configurable actionlint executable path.
- Optional [shellcheck] and [pyflakes] integration for deeper `run:` step
  analysis.
- Status bar indicator showing lint state.
- Output channel logging with configurable verbosity.

## Configuration

All settings live under the `actionlint.*` namespace.

| Setting                           | Type                             | Default        | Description                                                                                                                                                                     |
| --------------------------------- | -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionlint.enable`               | `boolean`                        | `true`         | Enable or disable actionlint linting.                                                                                                                                           |
| `actionlint.executable`           | `string`                         | `"actionlint"` | Path to the actionlint binary.                                                                                                                                                  |
| `actionlint.runTrigger`           | `"onSave"` \| `"onType"`         | `"onSave"`     | When to run actionlint: on file save or on typing.                                                                                                                              |
| `actionlint.debounceDelay`        | `number`                         | `300`          | Debounce delay in ms for `onType` trigger mode (50–5000).                                                                                                                       |
| `actionlint.ignoreErrors`         | `string[]`                       | `[]`           | Regex patterns to ignore matching errors (maps to `-ignore` flags).                                                                                                             |
| `actionlint.shellcheckExecutable` | `string`                         | `""`           | Path to `shellcheck` binary. Empty = auto-detect.                                                                                                                               |
| `actionlint.pyflakesExecutable`   | `string`                         | `""`           | Path to `pyflakes` binary. Empty = auto-detect.                                                                                                                                 |
| `actionlint.additionalArgs`       | `string[]`                       | `[]`           | Additional arguments to pass to actionlint.                                                                                                                                     |
| `actionlint.logLevel`             | `"off"` \| `"info"` \| `"debug"` | `"off"`        | Output channel logging verbosity.                                                                                                                                               |
| `actionlint.ruleSeverities`       | `object`                         | `{}`           | Override diagnostic severity for specific rule kinds. Keys are rule kind strings (e.g. `syntax-check`, `credentials`), values are `error`, `warning`, `information`, or `hint`. |

> **Note:** Settings marked as `restricted` (`executable`,
> `shellcheckExecutable`, `pyflakesExecutable`, `additionalArgs`) are ignored
> in [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust).

## License

[MIT](LICENSE)

[vscode-ext]: https://marketplace.visualstudio.com/items?itemName=jimeh.actionlint
[openvsx-ext]: https://open-vsx.org/extension/jimeh/actionlint
[actionlint]: https://github.com/rhysd/actionlint
[shellcheck]: https://github.com/koalaman/shellcheck
[pyflakes]: https://github.com/PyCQA/pyflakes
[VS Code Marketplace]: https://marketplace.visualstudio.com/items?itemName=jimeh.actionlint
[Open VSX]: https://open-vsx.org/extension/jimeh/actionlint
