import * as vscode from "vscode";
import type { ActionlintError } from "./types";

/**
 * Converts actionlint errors to VS Code Diagnostic objects.
 *
 * actionlint uses 1-based line/column numbers;
 * VS Code uses 0-based line/column numbers.
 *
 * actionlint provides `end_column` but no `end_line` — errors
 * always span a single line.
 */
export function toDiagnostics(errors: ActionlintError[]): vscode.Diagnostic[] {
  return errors.map((err) => {
    const line = Math.max(0, err.line - 1);
    const col = Math.max(0, err.column - 1);
    const endCol = err.end_column > err.column ? err.end_column - 1 : col + 1;

    const range = new vscode.Range(line, col, line, endCol);

    const diagnostic = new vscode.Diagnostic(
      range,
      err.message,
      vscode.DiagnosticSeverity.Error,
    );

    diagnostic.source = "actionlint";
    diagnostic.code = err.kind;

    return diagnostic;
  });
}
