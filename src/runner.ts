import { execFile } from "node:child_process";
import type { ActionlintError, ActionlintConfig } from "./types";

/** Result of running actionlint on a single file. */
export interface RunResult {
  errors: ActionlintError[];
  /** Present when actionlint failed to execute (not lint errors). */
  executionError?: string;
}

/**
 * Runs actionlint against the given file content via stdin.
 *
 * Uses `-stdin-filename` so actionlint can infer context (e.g.
 * repo-relative path for config lookup) and `-format '{{json .}}'`
 * for parseable JSON output.
 *
 * @param content  Full text of the workflow file.
 * @param filePath Workspace-relative or absolute path passed
 *                 to `-stdin-filename`.
 * @param config   Extension configuration.
 * @param cwd      Working directory (workspace root, so
 *                 `.github/actionlint.yaml` is found).
 */
export function runActionlint(
  content: string,
  filePath: string,
  config: ActionlintConfig,
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const args = [
      "-format",
      "{{json .}}",
      "-stdin-filename",
      filePath,
      ...config.additionalArgs,
      "-",
    ];

    const proc = execFile(
      config.executable,
      args,
      {
        cwd,
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      },
      (error, stdout, stderr) => {
        // ENOENT: binary not found.
        if (error && "code" in error && error.code === "ENOENT") {
          resolve({
            errors: [],
            executionError:
              `actionlint binary not found at "${config.executable}". ` +
              "Install it (https://github.com/rhysd/actionlint) " +
              "or set actionlint.executable in settings.",
          });
          return;
        }

        // Exit code 0: no issues. 1: issues found (normal).
        // Exit code >= 2: CLI or fatal error.
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : 0;

        if (exitCode >= 2) {
          resolve({
            errors: [],
            executionError:
              `actionlint exited with code ${exitCode}: ` +
              (stderr || stdout || "unknown error"),
          });
          return;
        }

        // Parse JSON output.
        try {
          const output = stdout.trim();
          if (!output || output === "null" || output === "[]") {
            resolve({ errors: [] });
            return;
          }
          const parsed: ActionlintError[] = JSON.parse(output);
          resolve({ errors: parsed });
        } catch {
          resolve({
            errors: [],
            executionError: `Failed to parse actionlint output: ${stdout}`,
          });
        }
      },
    );

    // Write file content to stdin.
    if (proc.stdin) {
      proc.stdin.write(content);
      proc.stdin.end();
    }
  });
}
