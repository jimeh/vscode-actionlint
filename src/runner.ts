import { execFile } from "node:child_process";
import type { ActionlintError, ActionlintConfig } from "./types";

/** Result of running actionlint on a single file. */
export interface RunResult {
  errors: ActionlintError[];
  /** Present when actionlint failed to execute (not lint errors). */
  executionError?: string;
  /** The executable that was invoked. */
  command?: string;
  /** The full argument list passed to the executable. */
  args?: string[];
  /** Process exit code (0 = clean, 1 = lint errors, >= 2 = fatal). */
  exitCode?: number;
  /** Raw stderr output from actionlint, if any. */
  stderr?: string;
}

/**
 * Runs actionlint against the given file content via stdin.
 *
 * Uses `-stdin-filename` so actionlint can infer context (e.g.
 * repo-relative path for config lookup) and `-format '{{json .}}'`
 * for parseable JSON output.
 *
 * @param content    Full text of the workflow file.
 * @param filePath   Workspace-relative or absolute path passed
 *                   to `-stdin-filename`.
 * @param config     Extension configuration.
 * @param cwd        Working directory (workspace root, so
 *                   `.github/actionlint.yaml` is found).
 * @param isTrusted  Whether the workspace is trusted. When false,
 *                   `additionalArgs` from config are ignored.
 * @param signal     Optional AbortSignal for cancellation.
 */
export function runActionlint(
  content: string,
  filePath: string,
  config: ActionlintConfig,
  cwd: string,
  isTrusted: boolean = true,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Already aborted — resolve immediately.
    if (signal?.aborted) {
      resolve({ errors: [] });
      return;
    }
    // Normalize Windows backslashes so actionlint always sees
    // forward-slash paths for -stdin-filename.
    const normalizedPath = filePath.replace(/\\/g, "/");

    const args = ["-format", "{{json .}}", "-stdin-filename", normalizedPath];

    for (const pattern of config.ignoreErrors ?? []) {
      args.push("-ignore", pattern);
    }
    if (config.shellcheckExecutable) {
      args.push("-shellcheck", config.shellcheckExecutable);
    }
    if (config.pyflakesExecutable) {
      args.push("-pyflakes", config.pyflakesExecutable);
    }

    if (isTrusted) {
      args.push(...(config.additionalArgs ?? []));
    }
    args.push("-");

    /** Resolve with command/args attached to every result. */
    const done = (
      result: RunResult,
      extra?: { exitCode?: number; stderr?: string },
    ): void => {
      resolve({
        ...result,
        command: config.executable,
        args,
        ...extra,
      });
    };

    const proc = execFile(
      config.executable,
      args,
      {
        cwd,
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
        signal,
      },
      (error, stdout, stderr) => {
        // Aborted via signal — treat as cancellation.
        if (signal?.aborted) {
          resolve({ errors: [] });
          return;
        }

        // ENOENT: binary not found.
        if (error && "code" in error && error.code === "ENOENT") {
          done(
            {
              errors: [],
              executionError:
                `actionlint binary not found at "${config.executable}". ` +
                "Install it (https://github.com/rhysd/actionlint) " +
                "or set actionlint.executable in settings.",
            },
            { stderr },
          );
          return;
        }

        // Process killed (timeout, signal, etc.).
        if (error && "killed" in error && error.killed) {
          done(
            {
              errors: [],
              executionError:
                "actionlint process was killed" +
                (error.signal ? ` (${error.signal})` : ""),
            },
            { stderr },
          );
          return;
        }

        // Other system-level errors (EACCES, ETIMEDOUT, etc.).
        if (
          error &&
          "code" in error &&
          typeof error.code === "string" &&
          error.code !== "ENOENT"
        ) {
          done(
            {
              errors: [],
              executionError:
                `actionlint execution failed (${error.code}): ` +
                (error.message || "unknown error"),
            },
            { stderr },
          );
          return;
        }

        // Exit code 0: no issues. 1: issues found (normal).
        // Exit code >= 2: CLI or fatal error.
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : 0;

        if (exitCode >= 2) {
          done(
            {
              errors: [],
              executionError:
                `actionlint exited with code ${exitCode}: ` +
                (stderr || stdout || "unknown error"),
            },
            { exitCode, stderr },
          );
          return;
        }

        // Parse JSON output.
        try {
          const output = stdout.trim();
          if (!output || output === "null" || output === "[]") {
            done({ errors: [] }, { exitCode, stderr });
            return;
          }
          const parsed: unknown = JSON.parse(output);
          if (!Array.isArray(parsed)) {
            done(
              {
                errors: [],
                executionError: "actionlint returned unexpected output format",
              },
              { exitCode, stderr },
            );
            return;
          }
          done({ errors: parsed as ActionlintError[] }, { exitCode, stderr });
        } catch {
          done(
            {
              errors: [],
              executionError: `Failed to parse actionlint output: ${stdout}`,
            },
            { exitCode, stderr },
          );
        }
      },
    );

    // Write file content to stdin.
    if (proc.stdin) {
      try {
        proc.stdin.write(content);
        proc.stdin.end();
      } catch {
        // Process already exited; callback handles the error.
      }
    }
  });
}
