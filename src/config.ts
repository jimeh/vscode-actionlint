import * as vscode from "vscode";
import type { ActionlintConfig } from "./types";

/** Reads the current extension configuration from VS Code settings. */
export function getConfig(): ActionlintConfig {
  const cfg = vscode.workspace.getConfiguration("actionlint");
  return {
    enable: cfg.get<boolean>("enable", true),
    executable: cfg.get<string>("executable", "actionlint"),
    runTrigger: cfg.get<"onSave" | "onType">("runTrigger", "onSave"),
    debounceDelay: cfg.get<number>("debounceDelay", 300),
    ignoreErrors: cfg.get<string[]>("ignoreErrors", []),
    shellcheckExecutable: cfg.get<string>("shellcheckExecutable", ""),
    pyflakesExecutable: cfg.get<string>("pyflakesExecutable", ""),
    additionalArgs: cfg.get<string[]>("additionalArgs", []),
    logLevel: cfg.get<"off" | "info" | "debug">("logLevel", "off"),
  };
}
