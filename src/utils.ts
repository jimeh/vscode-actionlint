import type * as vscode from "vscode";

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
  const filePath = document.uri.fsPath.replace(/\\/g, "/");
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
  const filePath = document.uri.fsPath.replace(/\\/g, "/");
  return /\.github\/actionlint\.(yml|yaml)$/.test(filePath);
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
