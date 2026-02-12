import * as vscode from "vscode";
import type { ActionlintConfig } from "./types";

/** Reads the current extension configuration from VS Code settings. */
export function getConfig(): ActionlintConfig {
  const cfg = vscode.workspace.getConfiguration("actionlint");
  return {
    enable: cfg.get<boolean>("enable", true),
    executable: cfg.get<string>("executable", "actionlint"),
    runTrigger: cfg.get<"onSave" | "onType">("runTrigger", "onSave"),
    additionalArgs: cfg.get<string[]>("additionalArgs", []),
    debounceDelay: cfg.get<number>("debounceDelay", 300),
    logLevel: cfg.get<"off" | "info" | "debug">("logLevel", "off"),
  };
}
