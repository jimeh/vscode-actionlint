import * as assert from "assert";
import * as vscode from "vscode";
import { toDiagnostics } from "../diagnostics";
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
    const diags = toDiagnostics([makeError()]);
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
});
