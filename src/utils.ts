import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";

/**
 * Normalize Windows backslashes to forward slashes.
 * Used for consistent path separators in actionlint args
 * and regex-based path matching.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Checks whether a document is a GitHub Actions workflow file.
 * Matches YAML files whose path ends with
 * `.github/workflows/<name>.(yml|yaml)`.
 *
 * Accepts both "yaml" and "github-actions-workflow" language IDs
 * so the extension works regardless of whether the official
 * GitHub Actions extension is installed.
 */
export function isWorkflowFile(document: vscode.TextDocument): boolean {
  const lang = document.languageId;
  if (lang !== "yaml" && lang !== "github-actions-workflow") {
    return false;
  }
  const filePath = normalizePath(document.uri.fsPath);
  return /\.github\/workflows\/[^/]+\.(yml|yaml)$/.test(filePath);
}

/**
 * Checks whether a document is an actionlint config file.
 * Matches YAML files whose path ends with
 * `.github/actionlint.(yml|yaml)`.
 */
export function isActionlintConfigFile(document: vscode.TextDocument): boolean {
  if (document.languageId !== "yaml") {
    return false;
  }
  const filePath = normalizePath(document.uri.fsPath);
  return /\.github\/actionlint\.(yml|yaml)$/.test(filePath);
}

/** Supported config file basenames, in priority order. */
export const CONFIG_FILE_NAMES = ["actionlint.yaml", "actionlint.yml"] as const;

/** Glob pattern for VS Code file system watchers. */
export const CONFIG_FILE_GLOB = "**/.github/actionlint.{yaml,yml}";

/**
 * Find an existing actionlint config file in a workspace folder.
 * Checks `.github/actionlint.yaml` first, then `.yml`.
 * Returns the full path and basename, or undefined if not found.
 */
export function findConfigFile(
  workspaceRoot: string,
): { filePath: string; baseName: string } | undefined {
  const dir = path.join(workspaceRoot, ".github");
  for (const name of CONFIG_FILE_NAMES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      return { filePath: file, baseName: name };
    }
  }
  return undefined;
}

/**
 * Returns a debounced version of `fn`. Pending invocations are
 * cancelled when called again within the delay window.
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): T & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: any[]) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced as T & { cancel(): void };
}
