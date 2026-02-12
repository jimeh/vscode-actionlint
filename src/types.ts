/**
 * A single error from actionlint JSON output.
 * Field names match actionlint's JSON serialization (snake_case).
 */
export interface ActionlintError {
  message: string;
  filepath: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number (start). */
  column: number;
  /** 1-based column number (end). 0 if unavailable. */
  end_column: number;
  /** Rule kind, e.g. "syntax-check", "expression", "action". */
  kind: string;
  /** Source code snippet with error indicator. */
  snippet: string;
}

/** Signature of the runner function used by ActionlintLinter. */
export type RunActionlint = (
  content: string,
  filePath: string,
  config: ActionlintConfig,
  cwd: string,
  isTrusted?: boolean,
  signal?: AbortSignal,
) => Promise<import("./runner").RunResult>;

/** Extension configuration mirroring package.json settings. */
export interface ActionlintConfig {
  enable: boolean;
  executable: string;
  runTrigger: "onSave" | "onType";
  additionalArgs: string[];
  debounceDelay: number;
  logLevel: "off" | "info" | "debug";
}
