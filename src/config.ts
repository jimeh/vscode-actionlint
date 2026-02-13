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
 * Reads extension configuration from VS Code settings.
 *
 * In untrusted workspaces, executable-path settings are resolved only
 * from trusted scopes (user/default), and additional args are dropped.
 */
export function getConfig(
  isTrusted: boolean = vscode.workspace.isTrusted,
): ActionlintConfig {
  const cfg = vscode.workspace.getConfiguration("actionlint");
  const executable = isTrusted
    ? cfg.get<string>("executable", "actionlint")
    : getTrustedScopeValue(cfg, "executable", "actionlint");
  const shellcheckExecutable = isTrusted
    ? cfg.get<string>("shellcheckExecutable", "")
    : getTrustedScopeValue(cfg, "shellcheckExecutable", "");
  const pyflakesExecutable = isTrusted
    ? cfg.get<string>("pyflakesExecutable", "")
    : getTrustedScopeValue(cfg, "pyflakesExecutable", "");

  return {
    enable: cfg.get<boolean>("enable", true),
    executable,
    runTrigger: cfg.get<"onSave" | "onType">("runTrigger", "onSave"),
    debounceDelay: cfg.get<number>("debounceDelay", 300),
    ignoreErrors: cfg.get<string[]>("ignoreErrors", []),
    shellcheckExecutable,
    pyflakesExecutable,
    additionalArgs: isTrusted ? cfg.get<string[]>("additionalArgs", []) : [],
    logLevel: cfg.get<"off" | "info" | "debug">("logLevel", "off"),
  };
}
