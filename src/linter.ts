import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import { toDiagnostics } from "./diagnostics";
import type { Logger } from "./logger";
import { runActionlint } from "./runner";
import type { StatusBar } from "./status-bar";
import type { RunActionlint } from "./types";
import { debounce, isWorkflowFile } from "./utils";

/**
 * Core linting orchestration. Manages event listeners, invokes
 * actionlint, and updates diagnostics and status bar.
 */
export class ActionlintLinter implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly logger: Logger;
  private readonly statusBar: StatusBar;
  private readonly runner: RunActionlint;

  /**
   * Monotonically increasing counter to detect stale lint results.
   * Each call to lintDocument captures the current value; if a newer
   * operation starts before the await completes, the stale result is
   * discarded.
   */
  private operationId = 0;

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

  constructor(
    logger: Logger,
    statusBar: StatusBar,
    runner?: RunActionlint,
  ) {
    this.logger = logger;
    this.statusBar = statusBar;
    this.runner = runner ?? runActionlint;
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

    this.permanentDisposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.updateStatusBarForEditor(editor);
      }),
    );
  }

  /**
   * Sync the status bar to reflect the diagnostics state of the
   * active editor's document. Hides the status bar when the active
   * file is not a workflow file.
   */
  private updateStatusBarForEditor(
    editor: vscode.TextEditor | undefined,
  ): void {
    if (!editor || !isWorkflowFile(editor.document)) {
      this.statusBar.hide();
      return;
    }

    const diags = this.diagnostics.get(editor.document.uri);
    const count = diags?.length ?? 0;
    if (count > 0) {
      this.statusBar.errors(count);
    } else {
      this.statusBar.idle();
    }
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
      this.diagnostics.delete(document.uri);
      this.statusBar.idle();
      return;
    }

    if (!isWorkflowFile(document)) {
      return;
    }

    // Skip non-file URIs (e.g. untitled, git diff).
    if (document.uri.scheme !== "file") {
      this.logger.debug(
        `Skipping non-file URI: ${document.uri.toString()}`,
      );
      return;
    }

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd =
      workspaceFolder?.uri.fsPath ??
      path.dirname(document.uri.fsPath);

    const currentOp = ++this.operationId;
    const content = document.getText();
    const filePath =
      vscode.workspace.asRelativePath(document.uri, false);

    this.statusBar.running();
    this.logger.debug(`Linting ${filePath}`);
    const start = Date.now();

    const result = await this.runner(
      content,
      filePath,
      config,
      cwd,
      vscode.workspace.isTrusted,
    );

    // A newer lint was started while we were waiting — discard
    // these stale results.
    if (currentOp !== this.operationId) {
      this.logger.debug(
        `Discarding stale lint result for ${filePath}`,
      );
      return;
    }

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
        .showErrorMessage(
          `actionlint: ${result.executionError}`,
          "Show Output",
        )
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
        `${filePath}: ${diags.length} issue${
          diags.length !== 1 ? "s" : ""
        }`,
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
