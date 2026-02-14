import * as vscode from "vscode";
import type { ActionlintError } from "./types";

/**
 * Captures details from shellcheck messages embedded by actionlint.
 * Groups: [1]=SC code, [2]=severity, [3]=line, [4]=col, [5]=description.
 */
const shellcheckRe = /\b(SC\d+):(error|warning|info|style):(\d+):(\d+):\s*(.*)/;

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
export const kindSeverityMap: Record<string, vscode.DiagnosticSeverity> = {
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
    const m = shellcheckRe.exec(message);
    if (m) {
      return shellcheckSeverityMap[m[2]!] ?? vscode.DiagnosticSeverity.Error;
    }
  }

  return kindSeverityMap[kind] ?? vscode.DiagnosticSeverity.Error;
}

/**
 * Captures line:col and description from pyflakes messages
 * embedded by actionlint.
 * Groups: [1]=line, [2]=col, [3]=description.
 */
const pyflakesRe = /^pyflakes reported issue in this script: (\d+):(\d+): (.*)/;

/** Parsed script-relative position (1-based). */
export interface ScriptPosition {
  line: number;
  col: number;
}

/**
 * Extract script-relative position from a shellcheck message.
 * Returns undefined when the message lacks the expected pattern.
 */
export function parseShellcheckPosition(
  message: string,
): ScriptPosition | undefined {
  const m = shellcheckRe.exec(message);
  if (!m) {
    return undefined;
  }
  const line = parseInt(m[3]!, 10);
  const col = parseInt(m[4]!, 10);
  if (line < 1 || col < 1) {
    return undefined;
  }
  return { line, col };
}

/**
 * Extract script-relative position from a pyflakes message.
 * Returns undefined when the message lacks the expected pattern.
 */
export function parsePyflakesPosition(
  message: string,
): ScriptPosition | undefined {
  const m = pyflakesRe.exec(message);
  if (!m) {
    return undefined;
  }
  const line = parseInt(m[1]!, 10);
  const col = parseInt(m[2]!, 10);
  if (line < 1 || col < 1) {
    return undefined;
  }
  return { line, col };
}

/**
 * Resolve a script-relative position to a document Range.
 * Returns undefined when resolution fails (caller falls back
 * to the actionlint-reported `run:` position).
 *
 * @param runLine    0-based document line of the `run:` keyword
 * @param scriptPos  1-based line:col within the script body
 * @param lines      Document text split by newlines
 */
export function resolveScriptRange(
  runLine: number,
  scriptPos: ScriptPosition,
  lines: string[],
): vscode.Range | undefined {
  if (runLine < 0 || runLine >= lines.length) {
    return undefined;
  }

  const runText = lines[runLine]!;
  const runIdx = runText.indexOf("run:");
  if (runIdx === -1) {
    return undefined;
  }

  // Everything after "run:", then skip whitespace to find value.
  const afterColon = runText.substring(runIdx + 4);
  const value = afterColon.trimStart();
  if (value.length === 0) {
    return undefined;
  }

  const valueOffset = runIdx + 4 + (afterColon.length - value.length);

  if (/^[|>]/.test(value)) {
    // Block scalar (literal | or folded >).
    // Body starts on the next line; indentation is determined
    // by the first non-empty content line.
    const bodyStart = runLine + 1;

    let indentRef = bodyStart;
    while (indentRef < lines.length && lines[indentRef]!.trim() === "") {
      indentRef++;
    }
    if (indentRef >= lines.length) {
      return undefined;
    }

    const refLine = lines[indentRef]!;
    const indent = refLine.length - refLine.trimStart().length;

    const docLine = bodyStart + (scriptPos.line - 1);
    if (docLine < 0 || docLine >= lines.length) {
      return undefined;
    }

    const docCol = indent + (scriptPos.col - 1);
    if (docCol < 0) {
      return undefined;
    }

    const endCol = Math.max(docCol + 1, lines[docLine]!.trimEnd().length);
    return new vscode.Range(docLine, docCol, docLine, endCol);
  }

  // Inline scalar (plain, single-quoted, or double-quoted).
  if (scriptPos.line !== 1) {
    return undefined;
  }

  const quoteOffset = value.startsWith('"') || value.startsWith("'") ? 1 : 0;
  const docCol = valueOffset + quoteOffset + (scriptPos.col - 1);
  const lineText = lines[runLine]!;
  if (docCol < 0 || docCol >= lineText.length) {
    return undefined;
  }

  const endCol = Math.max(docCol + 1, lineText.trimEnd().length);
  return new vscode.Range(runLine, docCol, runLine, endCol);
}

/**
 * Converts actionlint errors to VS Code Diagnostic objects.
 *
 * actionlint uses 1-based line/column numbers;
 * VS Code uses 0-based line/column numbers.
 *
 * actionlint provides `end_column` but no `end_line` — errors
 * always span a single line.
 *
 * When `documentText` is provided, shellcheck and pyflakes
 * errors are resolved to their actual position within the
 * script body instead of pointing at the `run:` keyword.
 */
export function toDiagnostics(
  errors: ActionlintError[],
  overrides: Record<string, string> = {},
  documentText?: string,
): vscode.Diagnostic[] {
  let lines: string[] | undefined;

  return errors.map((err) => {
    const line = Math.max(0, err.line - 1);
    const col = Math.max(0, err.column - 1);
    // end_column is 1-based inclusive; VS Code Range end is 0-based
    // exclusive. 1-based inclusive == 0-based exclusive, so use as-is.
    const endCol = Math.max(
      col + 1,
      err.end_column > err.column ? err.end_column : col + 1,
    );

    let range = new vscode.Range(line, col, line, endCol);
    let message = err.message;
    let code: string | number = err.kind;

    if (err.kind === "shellcheck") {
      const m = shellcheckRe.exec(err.message);
      if (m) {
        code = `shellcheck:${m[1]!}`;
        if (m[5]) {
          message = m[5];
        }

        if (documentText !== undefined) {
          const scLine = parseInt(m[3]!, 10);
          const scCol = parseInt(m[4]!, 10);
          if (scLine >= 1 && scCol >= 1) {
            if (!lines) {
              lines = documentText.split("\n");
            }
            const resolved = resolveScriptRange(
              line,
              { line: scLine, col: scCol },
              lines,
            );
            if (resolved) {
              range = resolved;
            }
          }
        }
      }
    } else if (err.kind === "pyflakes") {
      const m = pyflakesRe.exec(err.message);
      if (m) {
        if (m[3]) {
          message = m[3];
        }

        if (documentText !== undefined) {
          const pfLine = parseInt(m[1]!, 10);
          const pfCol = parseInt(m[2]!, 10);
          if (pfLine >= 1 && pfCol >= 1) {
            if (!lines) {
              lines = documentText.split("\n");
            }
            const resolved = resolveScriptRange(
              line,
              { line: pfLine, col: pfCol },
              lines,
            );
            if (resolved) {
              range = resolved;
            }
          }
        }
      }
    }

    const diagnostic = new vscode.Diagnostic(
      range,
      message,
      toSeverity(err.kind, err.message, overrides),
    );

    diagnostic.source = "actionlint";
    diagnostic.code = code;

    return diagnostic;
  });
}
