import * as vscode from "vscode";
import { getConfig } from "./config";

/**
 * Configurable output channel logger.
 * Respects the `actionlint.logLevel` setting:
 * - "off": no logging
 * - "info": activation, errors, and warnings
 * - "debug": all of the above plus per-lint invocation details
 */
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("actionlint");
  }

  info(message: string): void {
    const level = getConfig().logLevel;
    if (level === "info" || level === "debug") {
      this.channel.appendLine(`[info] ${message}`);
    }
  }

  debug(message: string): void {
    if (getConfig().logLevel === "debug") {
      this.channel.appendLine(`[debug] ${message}`);
    }
  }

  error(message: string): void {
    const level = getConfig().logLevel;
    if (level !== "off") {
      this.channel.appendLine(`[error] ${message}`);
    }
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
