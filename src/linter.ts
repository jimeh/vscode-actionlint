import * as vscode from "vscode";
import { getConfig } from "./config";
import { toDiagnostics } from "./diagnostics";
import type { Logger } from "./logger";
import { runActionlint } from "./runner";
import type { StatusBar } from "./status-bar";
import { debounce, isWorkflowFile } from "./utils";

/**
 * Core linting orchestration. Manages event listeners, invokes
 * actionlint, and updates diagnostics and status bar.
 */
export class ActionlintLinter implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly logger: Logger;
  private readonly statusBar: StatusBar;

  /**
   * Disposables for trigger-specific listeners (save/change).
   * Rebuilt when configuration changes.
   */
  private triggerDisposables: vscode.Disposable[] = [];

  /** Permanent disposables (config change, close, open). */
  private permanentDisposables: vscode.Disposable[] = [];

  private debouncedLint:
    | (((doc: vscode.TextDocument) => void) & { cancel(): void })
    | undefined;

  constructor(logger: Logger, statusBar: StatusBar) {
    this.logger = logger;
    this.statusBar = statusBar;
    this.diagnostics =
      vscode.languages.createDiagnosticCollection("actionlint");

    this.registerPermanentListeners();
    this.registerTriggerListeners();
    this.lintOpenDocuments();
  }

  private registerPermanentListeners(): void {
    this.permanentDisposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("actionlint")) {
          this.logger.debug("Configuration changed, re-registering listeners");
          this.disposeTriggerListeners();
          this.registerTriggerListeners();
          this.lintOpenDocuments();
        }
      }),
    );

    this.permanentDisposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnostics.delete(doc.uri);
      }),
    );

    this.permanentDisposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.lintDocument(doc);
      }),
    );
  }

  private registerTriggerListeners(): void {
    const config = getConfig();

    // Always lint on save.
    this.triggerDisposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.lintDocument(doc);
      }),
    );

    // Additionally lint on type if configured.
    if (config.runTrigger === "onType") {
      this.debouncedLint = debounce((doc: vscode.TextDocument) => {
        this.lintDocument(doc);
      }, config.debounceDelay);

      this.triggerDisposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          this.debouncedLint?.(e.document);
        }),
      );
    }
  }

  private disposeTriggerListeners(): void {
    this.debouncedLint?.cancel();
    this.debouncedLint = undefined;
    for (const d of this.triggerDisposables) {
      d.dispose();
    }
    this.triggerDisposables = [];
  }

  async lintDocument(document: vscode.TextDocument): Promise<void> {
    const config = getConfig();

    if (!config.enable) {
      this.diagnostics.clear();
      this.statusBar.idle();
      return;
    }

    if (!isWorkflowFile(document)) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd = workspaceFolder?.uri.fsPath ?? "";

    const content = document.getText();
    const filePath = vscode.workspace.asRelativePath(document.uri, false);

    this.statusBar.running();
    this.logger.debug(`Linting ${filePath}`);
    const start = Date.now();

    const result = await runActionlint(content, filePath, config, cwd);

    const elapsed = Date.now() - start;
    this.logger.debug(`Lint finished in ${elapsed}ms`);

    if (result.executionError) {
      this.logger.error(result.executionError);
      if (result.executionError.includes("not found")) {
        this.statusBar.notInstalled();
      } else {
        this.statusBar.idle();
      }
      vscode.window
        .showErrorMessage(`actionlint: ${result.executionError}`, "Show Output")
        .then((choice) => {
          if (choice === "Show Output") {
            this.logger.show();
          }
        });
      return;
    }

    const diags = toDiagnostics(result.errors);
    this.diagnostics.set(document.uri, diags);

    if (diags.length > 0) {
      this.statusBar.errors(diags.length);
      this.logger.info(
        `${filePath}: ${diags.length} issue${diags.length !== 1 ? "s" : ""}`,
      );
    } else {
      this.statusBar.idle();
    }
  }

  private lintOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      this.lintDocument(doc);
    }
  }

  dispose(): void {
    this.disposeTriggerListeners();
    for (const d of this.permanentDisposables) {
      d.dispose();
    }
    this.diagnostics.dispose();
  }
}
