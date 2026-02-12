import * as vscode from "vscode";
import { ActionlintLinter } from "./linter";
import { Logger } from "./logger";
import { StatusBar } from "./status-bar";

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  const statusBar = new StatusBar();

  // Register "show output" command used by status bar click.
  context.subscriptions.push(
    vscode.commands.registerCommand("actionlint.showOutput", () => {
      logger.show();
    }),
  );

  const linter = new ActionlintLinter(logger, statusBar);

  context.subscriptions.push(logger);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(linter);

  logger.info("actionlint extension activated");
}
