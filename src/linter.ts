import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import { toDiagnostics } from "./diagnostics";
import type { Logger } from "./logger";
import { runActionlint } from "./runner";
import type { StatusBar } from "./status-bar";
import type { RunActionlint } from "./types";
import { debounce, isWorkflowFile } from "./utils";

/** Debounced function type with cancel capability. */
type DebouncedFn = ((doc: vscode.TextDocument) => void) & { cancel(): void };

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
   * Per-document operation counter to detect stale lint results.
   * Keyed by document URI string.
   */
  private operationIds = new Map<string, number>();

  /**
   * Disposables for trigger-specific listeners (save/change).
   * Rebuilt when configuration changes.
   */
  private triggerDisposables: vscode.Disposable[] = [];

  /** Permanent disposables (config change, close, open). */
  private permanentDisposables: vscode.Disposable[] = [];

  /**
   * Per-document debounce functions for onType linting.
   * Keyed by document URI string.
   */
  private debouncedLints = new Map<string, DebouncedFn>();

  /**
   * Per-document AbortControllers. Aborts the previous lint
   * when a new one starts for the same document.
   * Keyed by document URI string.
   */
  private abortControllers = new Map<string, AbortController>();

  /** Set to true after dispose() is called. */
  private disposed = false;

  constructor(logger: Logger, statusBar: StatusBar, runner?: RunActionlint) {
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
        const key = doc.uri.toString();
        this.diagnostics.delete(doc.uri);
        this.operationIds.delete(key);
        this.cleanupDocument(key);
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
      this.triggerDisposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          const key = e.document.uri.toString();
          let fn = this.debouncedLints.get(key);
          if (!fn) {
            fn = debounce((doc: vscode.TextDocument) => {
              this.lintDocument(doc);
            }, config.debounceDelay);
            this.debouncedLints.set(key, fn);
          }
          fn(e.document);
        }),
      );
    }
  }

  private disposeTriggerListeners(): void {
    for (const fn of this.debouncedLints.values()) {
      fn.cancel();
    }
    this.debouncedLints.clear();
    for (const d of this.triggerDisposables) {
      d.dispose();
    }
    this.triggerDisposables = [];
  }

  /**
   * Clean up per-document state (debounce, abort controller).
   */
  private cleanupDocument(key: string): void {
    const fn = this.debouncedLints.get(key);
    if (fn) {
      fn.cancel();
      this.debouncedLints.delete(key);
    }
    const ctrl = this.abortControllers.get(key);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(key);
    }
  }

  /** Check whether a document is the active editor's document. */
  private isActiveDocument(doc: vscode.TextDocument): boolean {
    const active = vscode.window.activeTextEditor;
    return (
      active !== undefined &&
      active.document.uri.toString() === doc.uri.toString()
    );
  }

  async lintDocument(document: vscode.TextDocument): Promise<void> {
    const config = getConfig();

    if (!config.enable) {
      this.diagnostics.delete(document.uri);
      if (this.isActiveDocument(document)) {
        this.statusBar.idle();
      }
      return;
    }

    if (!isWorkflowFile(document)) {
      return;
    }

    // Skip non-file URIs (e.g. untitled, git diff).
    if (document.uri.scheme !== "file") {
      this.logger.debug(`Skipping non-file URI: ${document.uri.toString()}`);
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd =
      workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);

    const key = document.uri.toString();

    // Increment per-document operation counter.
    const prev = this.operationIds.get(key) ?? 0;
    const currentOp = prev + 1;
    this.operationIds.set(key, currentOp);

    // Abort any in-flight lint for this document.
    const prevCtrl = this.abortControllers.get(key);
    if (prevCtrl) {
      prevCtrl.abort();
    }
    const controller = new AbortController();
    this.abortControllers.set(key, controller);

    const content = document.getText();
    const filePath = workspaceFolder
      ? path
          .relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
          .replace(/\\/g, "/")
      : vscode.workspace.asRelativePath(document.uri, false);

    if (this.isActiveDocument(document)) {
      this.statusBar.running();
    }
    this.logger.debug(`Linting ${filePath}`);
    const start = Date.now();

    const result = await this.runner(
      content,
      filePath,
      config,
      cwd,
      vscode.workspace.isTrusted,
      controller.signal,
    );

    // Clean up abort controller if it's still ours.
    if (this.abortControllers.get(key) === controller) {
      this.abortControllers.delete(key);
    }

    // A newer lint was started while we were waiting — discard
    // these stale results.
    if (currentOp !== this.operationIds.get(key)) {
      this.logger.debug(`Discarding stale lint result for ${filePath}`);
      return;
    }

    // Guard: don't set diagnostics after dispose or doc close.
    if (this.disposed) {
      return;
    }

    const elapsed = Date.now() - start;
    this.logger.debug(`Lint finished in ${elapsed}ms`);

    if (result.executionError) {
      this.logger.error(result.executionError);
      if (result.executionError.includes("not found")) {
        // "not installed" is a global concern — always show.
        this.statusBar.notInstalled();
      } else if (this.isActiveDocument(document)) {
        this.statusBar.idle();
      }
      void Promise.resolve(
        vscode.window.showErrorMessage(
          `actionlint: ${result.executionError}`,
          "Show Output",
        ),
      ).then(
        (choice) => {
          if (choice === "Show Output") {
            this.logger.show();
          }
        },
        () => {},
      );
      return;
    }

    const diags = toDiagnostics(result.errors);
    this.diagnostics.set(document.uri, diags);

    if (this.isActiveDocument(document)) {
      if (diags.length > 0) {
        this.statusBar.errors(diags.length);
      } else {
        this.statusBar.idle();
      }
    }

    if (diags.length > 0) {
      this.logger.info(
        `${filePath}: ${diags.length} issue${diags.length !== 1 ? "s" : ""}`,
      );
    }
  }

  private lintOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      this.lintDocument(doc);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disposeTriggerListeners();
    for (const ctrl of this.abortControllers.values()) {
      ctrl.abort();
    }
    this.abortControllers.clear();
    this.operationIds.clear();
    for (const d of this.permanentDisposables) {
      d.dispose();
    }
    this.diagnostics.dispose();
  }
}
