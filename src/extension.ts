import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import { ActionlintLinter } from "./linter";
import { Logger } from "./logger";
import { StatusBar } from "./status-bar";
import { findConfigFile } from "./utils";

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  const statusBar = new StatusBar();

  // Register "show output" command used by status bar click.
  context.subscriptions.push(
    vscode.commands.registerCommand("actionlint.showOutput", () => {
      logger.show();
    }),
  );

  // Register "init config" command. Accepts an optional folder URI
  // string from status bar tooltip command links.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "actionlint.initConfig",
      (folderUri?: string) => initConfig(logger, folderUri),
    ),
  );

  const linter = new ActionlintLinter(logger, statusBar);

  context.subscriptions.push(logger);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(linter);

  logger.info("actionlint extension activated");
}

/**
 * Run `actionlint -init-config` in a workspace folder to create
 * `.github/actionlint.yaml`. Opens the file after creation, or
 * opens the existing file if one is already present.
 *
 * @param logger    Extension logger instance.
 * @param folderUri Optional folder URI string (from tooltip command
 *                  links). When provided, the folder picker is
 *                  skipped.
 */
async function initConfig(logger: Logger, folderUri?: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("actionlint: No workspace folder open.");
    return;
  }

  let folder: vscode.WorkspaceFolder | undefined;
  if (folderUri) {
    folder = folders.find((f) => f.uri.toString() === folderUri);
  }
  if (!folder) {
    folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Select workspace folder for actionlint config",
          });
  }
  if (!folder) {
    return;
  }

  const ghDir = path.join(folder.uri.fsPath, ".github");

  const existing = findConfigFile(folder.uri.fsPath);
  if (existing) {
    const doc = await vscode.workspace.openTextDocument(existing.filePath);
    await vscode.window.showTextDocument(doc);
    return;
  }

  // Ensure .github/workflows/ exists — actionlint requires
  // it to recognize a repo as using GitHub Actions.
  try {
    fs.mkdirSync(path.join(ghDir, "workflows"), {
      recursive: true,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create .github/workflows/: ${msg}`);
    vscode.window.showErrorMessage(
      `actionlint: Failed to create .github/workflows/. ` + msg,
    );
    return;
  }

  const config = getConfig();

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        config.executable,
        ["-init-config"],
        { cwd: folder.uri.fsPath, timeout: 10_000 },
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to run actionlint -init-config: ${msg}`);
    vscode.window.showErrorMessage(
      `actionlint: Failed to initialize config. ${msg}`,
    );
    return;
  }

  const created = findConfigFile(folder.uri.fsPath);
  if (created) {
    const doc = await vscode.workspace.openTextDocument(created.filePath);
    await vscode.window.showTextDocument(doc);
  }
}
