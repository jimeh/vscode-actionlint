import * as vscode from "vscode";
import type { ActionlintConfig } from "./types";

/**
 * Resolve a setting from trusted scopes only (user/default), ignoring
 * workspace and workspace-folder values.
 */
function getTrustedScopeValue<T>(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  fallback: T,
): T {
  const inspected = cfg.inspect<T>(key);
  if (inspected?.globalLanguageValue !== undefined) {
    return inspected.globalLanguageValue;
  }
  if (inspected?.globalValue !== undefined) {
    return inspected.globalValue;
  }
  if (inspected?.defaultLanguageValue !== undefined) {
    return inspected.defaultLanguageValue;
  }
  if (inspected?.defaultValue !== undefined) {
    return inspected.defaultValue;
  }
  return fallback;
}

/**
 * Read a config value, using only trusted scopes (user/default)
 * when the workspace is untrusted. Used for restricted settings
 * like executable paths.
 */
function getRestrictedValue<T>(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  fallback: T,
  isTrusted: boolean,
): T {
  return isTrusted
    ? cfg.get<T>(key, fallback)
    : getTrustedScopeValue(cfg, key, fallback);
}

/**
 * Reads extension configuration from VS Code settings.
 *
 * In untrusted workspaces, executable-path settings are resolved only
 * from trusted scopes (user/default), and additional args are dropped.
 */
export function getConfig(
  isTrusted: boolean = vscode.workspace.isTrusted,
): ActionlintConfig {
  const cfg = vscode.workspace.getConfiguration("actionlint");

  return {
    enable: cfg.get<boolean>("enable", true),
    executable: getRestrictedValue(cfg, "executable", "actionlint", isTrusted),
    runTrigger: cfg.get<"onSave" | "onType">("runTrigger", "onType"),
    debounceDelay: cfg.get<number>("debounceDelay", 300),
    ignoreErrors: cfg.get<string[]>("ignoreErrors", []),
    shellcheckExecutable: getRestrictedValue(
      cfg,
      "shellcheckExecutable",
      "",
      isTrusted,
    ),
    pyflakesExecutable: getRestrictedValue(
      cfg,
      "pyflakesExecutable",
      "",
      isTrusted,
    ),
    additionalArgs: isTrusted ? cfg.get<string[]>("additionalArgs", []) : [],
    logLevel: cfg.get<"off" | "info" | "debug">("logLevel", "off"),
    ruleSeverities: cfg.get<Record<string, string>>("ruleSeverities", {}),
  };
}
