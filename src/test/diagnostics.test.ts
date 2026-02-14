import * as assert from "assert";
import * as vscode from "vscode";
import {
  kindSeverityMap,
  parsePyflakesPosition,
  parseShellcheckPosition,
  resolveScriptRange,
  toDiagnostics,
} from "../diagnostics";
import { at, makeError } from "./helpers";

suite("toDiagnostics", () => {
  test("converts 1-based line/column to 0-based", () => {
    const diags = toDiagnostics([makeError({ line: 10, column: 5 })]);
    assert.strictEqual(diags.length, 1);
    const d = at(diags, 0);
    assert.strictEqual(d.range.start.line, 9);
    assert.strictEqual(d.range.start.character, 4);
  });

  test("uses end_column for range end when available", () => {
    // end_column is 1-based inclusive; 0-based exclusive
    // is the same value.
    const diags = toDiagnostics([makeError({ column: 3, end_column: 10 })]);
    const d = at(diags, 0);
    assert.strictEqual(d.range.start.character, 2);
    assert.strictEqual(d.range.end.character, 10);
  });

  test("falls back to col+1 when end_column equals column", () => {
    const diags = toDiagnostics([makeError({ column: 3, end_column: 3 })]);
    const d = at(diags, 0);
    assert.strictEqual(d.range.start.character, 2);
    assert.strictEqual(d.range.end.character, 3);
  });

  test("falls back to col+1 when end_column is 0", () => {
    const diags = toDiagnostics([makeError({ column: 3, end_column: 0 })]);
    const d = at(diags, 0);
    assert.strictEqual(d.range.start.character, 2);
    assert.strictEqual(d.range.end.character, 3);
  });

  test("sets source to 'actionlint'", () => {
    const diags = toDiagnostics([makeError()]);
    assert.strictEqual(at(diags, 0).source, "actionlint");
  });

  test("sets code to error kind", () => {
    const diags = toDiagnostics([makeError({ kind: "expression" })]);
    assert.strictEqual(at(diags, 0).code, "expression");
  });

  test("sets severity to Error for non-shellcheck errors", () => {
    // Regression: a non-shellcheck kind whose message contains an
    // SC####:severity: substring must not be remapped by the
    // shellcheck regex.
    const diags = toDiagnostics([
      makeError({
        kind: "expression",
        message:
          "shellcheck reported issue in this script: " +
          "SC2086:info:1:5: Double quote to prevent globbing",
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  test("maps shellcheck error to Error", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2086:error:1:5: Double quote to prevent globbing",
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  test("maps shellcheck warning to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2086:warning:1:5: Double quote to prevent globbing",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps shellcheck info to Information", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2035:info:1:35: Use ./*glob* or -- *glob*",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Information,
    );
  });

  test("maps shellcheck style to Hint", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2004:style:1:3: Remove $ on arithmetic variables",
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Hint);
  });

  test("shellcheck kind without severity in message falls back to Error", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message: "shellcheck reported issue: unusual format",
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  // -- Kind-based severity: Error tier --

  test("maps expression kind to Error", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "expression",
        message: 'property "foo" is not defined',
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  test("maps action kind to Error", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "action",
        message: 'input "node-version" is not defined',
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  // -- Kind-based severity: Warning tier --

  test("maps events kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "events",
        message: "unknown webhook event",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps credentials kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "credentials",
        message: '"password" section in "credentials" is hardcoded',
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps deprecated-commands kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "deprecated-commands",
        message: "workflow command is deprecated",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps runner-label kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "runner-label",
        message: 'label "foo" is unknown',
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps permissions kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "permissions",
        message: 'unknown permission scope "deploy"',
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps id kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "id",
        message: 'step ID "build" duplicates',
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps glob kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "glob",
        message: "invalid glob pattern",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("maps pyflakes kind to Warning", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "pyflakes",
        message:
          "pyflakes reported issue in this script: " +
          "1:7: undefined name 'hello'",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  // -- Kind-based severity: Information tier --

  test("maps if-cond kind to Information", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "if-cond",
        message: "if condition is always true",
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Information,
    );
  });

  test("maps env-var kind to Information", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "env-var",
        message:
          'environment variable name "my-var" is not formatted correctly',
      }),
    ]);
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Information,
    );
  });

  // -- Unknown kind fallback --

  test("maps unknown kind to Error", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "future-rule",
        message: "something new",
      }),
    ]);
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  // -- kindSeverityMap snapshot --

  test("kindSeverityMap contains expected entries", () => {
    assert.deepStrictEqual(kindSeverityMap, {
      "syntax-check": vscode.DiagnosticSeverity.Error,
      expression: vscode.DiagnosticSeverity.Error,
      action: vscode.DiagnosticSeverity.Error,
      "workflow-call": vscode.DiagnosticSeverity.Error,
      "shell-name": vscode.DiagnosticSeverity.Error,
      matrix: vscode.DiagnosticSeverity.Error,
      "job-needs": vscode.DiagnosticSeverity.Error,
      events: vscode.DiagnosticSeverity.Warning,
      "runner-label": vscode.DiagnosticSeverity.Warning,
      permissions: vscode.DiagnosticSeverity.Warning,
      credentials: vscode.DiagnosticSeverity.Warning,
      "deprecated-commands": vscode.DiagnosticSeverity.Warning,
      id: vscode.DiagnosticSeverity.Warning,
      glob: vscode.DiagnosticSeverity.Warning,
      pyflakes: vscode.DiagnosticSeverity.Warning,
      "if-cond": vscode.DiagnosticSeverity.Information,
      "env-var": vscode.DiagnosticSeverity.Information,
    });
  });

  // -- User severity overrides --

  test("user override downgrades Error kind to Warning", () => {
    const diags = toDiagnostics([makeError({ kind: "syntax-check" })], {
      "syntax-check": "warning",
    });
    assert.strictEqual(
      at(diags, 0).severity,
      vscode.DiagnosticSeverity.Warning,
    );
  });

  test("user override upgrades Warning kind to Error", () => {
    const diags = toDiagnostics([makeError({ kind: "credentials" })], {
      credentials: "error",
    });
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  test("user override sets kind to Hint", () => {
    const diags = toDiagnostics([makeError({ kind: "if-cond" })], {
      "if-cond": "hint",
    });
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Hint);
  });

  test("user override for shellcheck overrides message-embedded severity", () => {
    const diags = toDiagnostics(
      [
        makeError({
          kind: "shellcheck",
          message:
            "shellcheck reported issue in this script: " +
            "SC2086:error:1:5: Double quote to prevent globbing",
        }),
      ],
      { shellcheck: "hint" },
    );
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Hint);
  });

  test("invalid override value falls through to default", () => {
    const diags = toDiagnostics([makeError({ kind: "expression" })], {
      expression: "bogus",
    });
    assert.strictEqual(at(diags, 0).severity, vscode.DiagnosticSeverity.Error);
  });

  test("sets message from error", () => {
    const diags = toDiagnostics([makeError({ message: "unexpected key" })]);
    assert.strictEqual(at(diags, 0).message, "unexpected key");
  });

  test("returns empty array for empty input", () => {
    const diags = toDiagnostics([]);
    assert.strictEqual(diags.length, 0);
  });

  test("handles multiple errors", () => {
    const diags = toDiagnostics([
      makeError({ line: 1, column: 1 }),
      makeError({ line: 5, column: 10 }),
      makeError({ line: 20, column: 1 }),
    ]);
    assert.strictEqual(diags.length, 3);
  });

  test("clamps negative line/column to 0", () => {
    const diags = toDiagnostics([
      makeError({ line: 0, column: 0, end_column: 0 }),
    ]);
    const d = at(diags, 0);
    assert.strictEqual(d.range.start.line, 0);
    assert.strictEqual(d.range.start.character, 0);
  });

  test("handles end_column < column (corrupt data)", () => {
    const diags = toDiagnostics([makeError({ column: 5, end_column: 2 })]);
    const range = at(diags, 0).range;
    assert.ok(
      range.end.character >= range.start.character,
      `end (${range.end.character}) should be >= ` +
        `start (${range.start.character})`,
    );
    // col = 4 (0-based), fallback to col+1 = 5
    assert.strictEqual(range.start.character, 4);
    assert.strictEqual(range.end.character, 5);
  });

  test("handles end_column = column = 1 (single char)", () => {
    const diags = toDiagnostics([makeError({ column: 1, end_column: 1 })]);
    const range = at(diags, 0).range;
    // col = 0, endCol = col+1 = 1
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, 1);
  });

  // -- Shellcheck position resolution via documentText --

  test("resolves shellcheck error to script body position", () => {
    const doc = [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      "          echo hello",
      "          cat *.vsix",
    ].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "shellcheck",
          message:
            "shellcheck reported issue in this script: " +
            "SC2035:info:2:5: Use ./*glob* or -- *glob*",
          line: 7, // 1-based, points to "run:"
          column: 9,
          end_column: 0,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Line 8 (0-based), col 14 = the '*' in "cat *.vsix"
    assert.strictEqual(d.range.start.line, 8);
    assert.strictEqual(d.range.start.character, 14);
    // End = trimmed end of "          cat *.vsix" = 20
    assert.strictEqual(d.range.end.character, 20);
  });

  test("resolves shellcheck error to first line of block scalar", () => {
    const doc = ["      - run: |", "          echo $foo"].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "shellcheck",
          message:
            "shellcheck reported issue in this script: " +
            "SC2086:error:1:6: Double quote to prevent globbing",
          line: 1,
          column: 9,
          end_column: 0,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Line 1 (0-based), col 15 = '$' in "echo $foo"
    assert.strictEqual(d.range.start.line, 1);
    assert.strictEqual(d.range.start.character, 15);
  });

  test("falls back to run: position without documentText", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2035:info:2:5: Use ./*glob*",
        line: 7,
        column: 9,
        end_column: 12,
      }),
    ]);
    const d = at(diags, 0);
    // Uses actionlint position: line 6 (0-based), col 8
    assert.strictEqual(d.range.start.line, 6);
    assert.strictEqual(d.range.start.character, 8);
  });

  test("falls back when shellcheck message lacks line:col", () => {
    const doc = ["      - run: |", "          echo hello"].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "shellcheck",
          message: "shellcheck reported issue: unusual format",
          line: 1,
          column: 9,
          end_column: 12,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Falls back to actionlint position
    assert.strictEqual(d.range.start.line, 0);
    assert.strictEqual(d.range.start.character, 8);
  });

  test("strips shellcheck prefix from message", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2035:info:2:5: Use ./*glob* or -- *glob*",
      }),
    ]);
    const d = at(diags, 0);
    assert.strictEqual(d.message, "Use ./*glob* or -- *glob*");
  });

  test("sets diagnostic code to SC code for shellcheck", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "shellcheck",
        message:
          "shellcheck reported issue in this script: " +
          "SC2086:error:1:5: Double quote to prevent globbing",
      }),
    ]);
    assert.strictEqual(at(diags, 0).code, "shellcheck:SC2086");
  });

  test("keeps original message when shellcheck format unrecognized", () => {
    const msg = "shellcheck reported issue: unusual format";
    const diags = toDiagnostics([
      makeError({ kind: "shellcheck", message: msg }),
    ]);
    assert.strictEqual(at(diags, 0).message, msg);
    assert.strictEqual(at(diags, 0).code, "shellcheck");
  });

  test("non-shellcheck kind ignores documentText", () => {
    const doc = ["      - run: |", "          echo hello"].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "expression",
          message:
            "shellcheck reported issue in this script: " +
            "SC2086:error:1:5: Double quote",
          line: 1,
          column: 9,
          end_column: 12,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Uses actionlint position even though message has SC pattern
    assert.strictEqual(d.range.start.line, 0);
    assert.strictEqual(d.range.start.character, 8);
  });

  // -- Pyflakes position resolution via documentText --

  test("resolves pyflakes error to script body position", () => {
    const doc = [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-python@v5",
      "      - run: |",
      "          import os",
      "          import sys",
      "          print(os.getcwd())",
    ].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "pyflakes",
          message:
            "pyflakes reported issue in this script: " +
            "2:1: 'sys' imported but unused",
          line: 8, // 1-based, points to "run:"
          column: 9,
          end_column: 0,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Line 9 (0-based), col 10 = start of "import sys"
    assert.strictEqual(d.range.start.line, 9);
    assert.strictEqual(d.range.start.character, 10);
  });

  test("resolves pyflakes error on first line of block scalar", () => {
    const doc = ["      - run: |", "          import sys"].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "pyflakes",
          message:
            "pyflakes reported issue in this script: " +
            "1:8: 'sys' imported but unused",
          line: 1,
          column: 9,
          end_column: 0,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Line 1 (0-based), col = 10 + (8-1) = 17
    assert.strictEqual(d.range.start.line, 1);
    assert.strictEqual(d.range.start.character, 17);
  });

  test("strips pyflakes prefix from message", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "pyflakes",
        message:
          "pyflakes reported issue in this script: " +
          "1:7: undefined name 'hello'",
      }),
    ]);
    const d = at(diags, 0);
    assert.strictEqual(d.message, "undefined name 'hello'");
  });

  test("sets diagnostic code to 'pyflakes'", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "pyflakes",
        message:
          "pyflakes reported issue in this script: " +
          "3:1: 'sys' imported but unused",
      }),
    ]);
    assert.strictEqual(at(diags, 0).code, "pyflakes");
  });

  test("keeps original message when pyflakes format unrecognized", () => {
    const msg = "pyflakes reported issue: unusual format";
    const diags = toDiagnostics([
      makeError({ kind: "pyflakes", message: msg }),
    ]);
    assert.strictEqual(at(diags, 0).message, msg);
    assert.strictEqual(at(diags, 0).code, "pyflakes");
  });

  test("falls back to run: position without documentText for pyflakes", () => {
    const diags = toDiagnostics([
      makeError({
        kind: "pyflakes",
        message:
          "pyflakes reported issue in this script: " +
          "2:1: 'sys' imported but unused",
        line: 8,
        column: 9,
        end_column: 12,
      }),
    ]);
    const d = at(diags, 0);
    // Uses actionlint position: line 7 (0-based), col 8
    assert.strictEqual(d.range.start.line, 7);
    assert.strictEqual(d.range.start.character, 8);
  });

  test("non-pyflakes kind ignores pyflakes-like message", () => {
    const doc = ["      - run: |", "          import sys"].join("\n");

    const diags = toDiagnostics(
      [
        makeError({
          kind: "expression",
          message:
            "pyflakes reported issue in this script: " +
            "1:8: 'sys' imported but unused",
          line: 1,
          column: 9,
          end_column: 12,
        }),
      ],
      {},
      doc,
    );
    const d = at(diags, 0);
    // Uses actionlint position, not resolved
    assert.strictEqual(d.range.start.line, 0);
    assert.strictEqual(d.range.start.character, 8);
  });
});

suite("parseShellcheckPosition", () => {
  test("parses severity:line:col from message", () => {
    const pos = parseShellcheckPosition(
      "shellcheck reported issue in this script: " +
        "SC2086:error:1:5: Double quote to prevent globbing",
    );
    assert.deepStrictEqual(pos, { line: 1, col: 5 });
  });

  test("parses multi-digit line and col", () => {
    const pos = parseShellcheckPosition(
      "shellcheck reported issue in this script: " +
        "SC2035:info:15:42: Use ./*glob*",
    );
    assert.deepStrictEqual(pos, { line: 15, col: 42 });
  });

  test("returns undefined for message without SC pattern", () => {
    const pos = parseShellcheckPosition(
      "shellcheck reported issue: unusual format",
    );
    assert.strictEqual(pos, undefined);
  });

  test("returns undefined for unrelated message", () => {
    const pos = parseShellcheckPosition('property "foo" is not defined');
    assert.strictEqual(pos, undefined);
  });
});

suite("parsePyflakesPosition", () => {
  test("parses line:col from standard message", () => {
    const pos = parsePyflakesPosition(
      "pyflakes reported issue in this script: " +
        "3:1: 'sys' imported but unused",
    );
    assert.deepStrictEqual(pos, { line: 3, col: 1 });
  });

  test("parses multi-digit line and col", () => {
    const pos = parsePyflakesPosition(
      "pyflakes reported issue in this script: " +
        "15:42: undefined name 'foo'",
    );
    assert.deepStrictEqual(pos, { line: 15, col: 42 });
  });

  test("returns undefined for shellcheck message", () => {
    const pos = parsePyflakesPosition(
      "shellcheck reported issue in this script: " +
        "SC2086:error:1:5: Double quote",
    );
    assert.strictEqual(pos, undefined);
  });

  test("returns undefined for unrelated message", () => {
    const pos = parsePyflakesPosition('property "foo" is not defined');
    assert.strictEqual(pos, undefined);
  });

  test("returns undefined for zero line", () => {
    const pos = parsePyflakesPosition(
      "pyflakes reported issue in this script: " + "0:1: some issue",
    );
    assert.strictEqual(pos, undefined);
  });

  test("returns undefined for zero col", () => {
    const pos = parsePyflakesPosition(
      "pyflakes reported issue in this script: " + "1:0: some issue",
    );
    assert.strictEqual(pos, undefined);
  });
});

suite("resolveScriptRange", () => {
  // Helper to build document lines from a template string.
  function lines(...strs: string[]): string[] {
    return strs;
  }

  // -- Block scalar tests --

  test("block scalar: resolves line 1", () => {
    const l = lines("      - run: |", "          echo hello");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 1);
    assert.strictEqual(r.start.character, 10);
  });

  test("block scalar: resolves line 2", () => {
    const l = lines(
      "      - run: |",
      "          echo hello",
      "          cat *.vsix",
    );
    const r = resolveScriptRange(0, { line: 2, col: 5 }, l);
    assert.ok(r);
    // Line 2 (0-based), col = 10 + (5-1) = 14
    assert.strictEqual(r.start.line, 2);
    assert.strictEqual(r.start.character, 14);
    // End = trimmed end of "          cat *.vsix" = 20
    assert.strictEqual(r.end.character, 20);
  });

  test("block scalar: handles empty lines in body", () => {
    const l = lines(
      "      - run: |",
      "          echo hello",
      "",
      "          cat *.vsix",
    );
    // linter sees: line 1="echo hello", line 2="",
    // line 3="cat *.vsix"
    const r = resolveScriptRange(0, { line: 3, col: 5 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 3);
    assert.strictEqual(r.start.character, 14);
  });

  test("block scalar: chomping indicator |- works", () => {
    const l = lines("      - run: |-", "          echo hello");
    const r = resolveScriptRange(0, { line: 1, col: 6 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 1);
    // col = 10 + (6-1) = 15
    assert.strictEqual(r.start.character, 15);
  });

  test("block scalar: folded > works", () => {
    const l = lines("      - run: >", "          echo hello");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 1);
    assert.strictEqual(r.start.character, 10);
  });

  test("block scalar: folded >- works", () => {
    const l = lines("      - run: >-", "          echo hello");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 1);
    assert.strictEqual(r.start.character, 10);
  });

  test("block scalar: line out of bounds returns undefined", () => {
    const l = lines("      - run: |", "          echo hello");
    const r = resolveScriptRange(0, { line: 99, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  test("block scalar: no content after indicator returns undefined", () => {
    const l = lines("      - run: |");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  // -- Inline scalar tests --

  test("inline: resolves position on same line", () => {
    //  "      - run: echo hello"
    // idx:  0123456789012345678901234
    const l = lines("      - run: echo hello");
    const r = resolveScriptRange(0, { line: 1, col: 6 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 0);
    // valueOffset=13 ('e'), col 6 = 13+(6-1)=18 ('h' in hello)
    assert.strictEqual(r.start.character, 18);
  });

  test("inline: script line > 1 returns undefined", () => {
    const l = lines("      - run: echo hello");
    const r = resolveScriptRange(0, { line: 2, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  test("inline: double-quoted resolves position", () => {
    //  '      - run: "echo hello"'
    // idx:  01234567890123456789012345
    const l = lines('      - run: "echo hello"');
    const r = resolveScriptRange(0, { line: 1, col: 6 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 0);
    // valueOffset=13 ('"'), quoteOffset=1, col 6 = 13+1+(6-1)=19
    assert.strictEqual(r.start.character, 19);
  });

  test("inline: single-quoted resolves position", () => {
    //  "      - run: 'echo hello'"
    // idx:  01234567890123456789012345
    const l = lines("      - run: 'echo hello'");
    const r = resolveScriptRange(0, { line: 1, col: 6 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 0);
    // valueOffset=13 ("'"), quoteOffset=1, col 6 = 13+1+(6-1)=19
    assert.strictEqual(r.start.character, 19);
  });

  test("inline: quoted col 1 targets first script char", () => {
    //  '      - run: "echo hello"'
    // idx:  01234567890123456789012345
    const l = lines('      - run: "echo hello"');
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.ok(r);
    assert.strictEqual(r.start.line, 0);
    // valueOffset=13, quoteOffset=1, col 1 = 13+1+(1-1)=14 ('e')
    assert.strictEqual(r.start.character, 14);
  });

  // -- Fallback/edge cases --

  test("runLine out of bounds returns undefined", () => {
    const l = lines("      - run: |", "          echo hello");
    const r = resolveScriptRange(99, { line: 1, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  test("negative runLine returns undefined", () => {
    const l = lines("      - run: |");
    const r = resolveScriptRange(-1, { line: 1, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  test("line without run: returns undefined", () => {
    const l = lines("      - uses: actions/checkout@v4");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });

  test("run: with no value returns undefined", () => {
    const l = lines("      - run:");
    const r = resolveScriptRange(0, { line: 1, col: 1 }, l);
    assert.strictEqual(r, undefined);
  });
});
