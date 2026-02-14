import * as vscode from "vscode";
import type { ActionlintError } from "./types";

const shellcheckSeverityRe = /\bSC\d+:(error|warning|info|style):/;

const shellcheckSeverityMap: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  style: vscode.DiagnosticSeverity.Hint,
};

/** Maps user-facing severity names to VS Code DiagnosticSeverity. */
const userSeverityMap: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Maps actionlint rule kinds to VS Code diagnostic severities. */
const kindSeverityMap: Record<string, vscode.DiagnosticSeverity> = {
  // Error — workflow will fail
  "syntax-check": vscode.DiagnosticSeverity.Error,
  expression: vscode.DiagnosticSeverity.Error,
  action: vscode.DiagnosticSeverity.Error,
  "workflow-call": vscode.DiagnosticSeverity.Error,
  "shell-name": vscode.DiagnosticSeverity.Error,
  matrix: vscode.DiagnosticSeverity.Error,
  "job-needs": vscode.DiagnosticSeverity.Error,
  // Warning — might fail, security risk, or deprecated
  events: vscode.DiagnosticSeverity.Warning,
  "runner-label": vscode.DiagnosticSeverity.Warning,
  permissions: vscode.DiagnosticSeverity.Warning,
  credentials: vscode.DiagnosticSeverity.Warning,
  "deprecated-commands": vscode.DiagnosticSeverity.Warning,
  id: vscode.DiagnosticSeverity.Warning,
  glob: vscode.DiagnosticSeverity.Warning,
  pyflakes: vscode.DiagnosticSeverity.Warning,
  // Information — surprising behavior or style
  "if-cond": vscode.DiagnosticSeverity.Information,
  "env-var": vscode.DiagnosticSeverity.Information,
};

/**
 * Derive VS Code severity from an actionlint error.
 *
 * Priority: user overrides → shellcheck message regex → kind map → Error.
 */
function toSeverity(
  kind: string,
  message: string,
  overrides: Record<string, string>,
): vscode.DiagnosticSeverity {
  const userOverride = overrides[kind];
  if (userOverride !== undefined) {
    const severity = userSeverityMap[userOverride];
    if (severity !== undefined) {
      return severity;
    }
  }

  if (kind === "shellcheck") {
    const m = shellcheckSeverityRe.exec(message);
    if (m) {
      return shellcheckSeverityMap[m[1]!] ?? vscode.DiagnosticSeverity.Error;
    }
  }

  return kindSeverityMap[kind] ?? vscode.DiagnosticSeverity.Error;
}

/**
 * Converts actionlint errors to VS Code Diagnostic objects.
 *
 * actionlint uses 1-based line/column numbers;
 * VS Code uses 0-based line/column numbers.
 *
 * actionlint provides `end_column` but no `end_line` — errors
 * always span a single line.
 */
export function toDiagnostics(
  errors: ActionlintError[],
  overrides: Record<string, string> = {},
): vscode.Diagnostic[] {
  return errors.map((err) => {
    const line = Math.max(0, err.line - 1);
    const col = Math.max(0, err.column - 1);
    // end_column is 1-based inclusive; VS Code Range end is 0-based
    // exclusive. 1-based inclusive == 0-based exclusive, so use as-is.
    const endCol = Math.max(
      col + 1,
      err.end_column > err.column ? err.end_column : col + 1,
    );

    const range = new vscode.Range(line, col, line, endCol);

    const diagnostic = new vscode.Diagnostic(
      range,
      err.message,
      toSeverity(err.kind, err.message, overrides),
    );

    diagnostic.source = "actionlint";
    diagnostic.code = err.kind;

    return diagnostic;
  });
}
