import * as path from "node:path";
import * as vscode from "vscode";
import { CancellableTask } from "./cancellable-task";
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
   * Per-document cancellable lint tasks. Handles abort signalling
   * and staleness detection. Keyed by document URI string.
   */
  private tasks = new Map<string, CancellableTask>();

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

  /** Set to true after dispose() is called. */
  private disposed = false;

  /**
   * Tracks whether actionlint binary was not found. Persists
   * across editor switches so the warning isn't lost.
   */
  private _notInstalled = false;

  /**
   * Tracks whether an unexpected-output warning has been shown.
   * Prevents repeated notifications until a successful lint.
   */
  private _unexpectedOutput = false;

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

    const config = getConfig();
    const diags = this.diagnostics.get(editor.document.uri);
    const count = diags?.length ?? 0;
    if (count > 0) {
      this.statusBar.errors(count, config.executable);
    } else if (this._notInstalled) {
      this.statusBar.notInstalled(config.executable);
    } else if (this._unexpectedOutput) {
      this.statusBar.unexpectedOutput(config.executable);
    } else {
      this.statusBar.idle(config.executable);
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
   * Clean up per-document state (debounce, cancellable task).
   */
  private cleanupDocument(key: string): void {
    const fn = this.debouncedLints.get(key);
    if (fn) {
      fn.cancel();
      this.debouncedLints.delete(key);
    }
    this.getTask(key).cancel();
    this.tasks.delete(key);
  }

  /** Get or create a {@link CancellableTask} for a document key. */
  private getTask(key: string): CancellableTask {
    let task = this.tasks.get(key);
    if (!task) {
      task = new CancellableTask();
      this.tasks.set(key, task);
    }
    return task;
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
        this.statusBar.idle(config.executable);
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
    const task = this.getTask(key);

    const content = document.getText();
    const filePath = workspaceFolder
      ? path
          .relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
          .replace(/\\/g, "/")
      : vscode.workspace.asRelativePath(document.uri, false);

    if (this.isActiveDocument(document)) {
      this.statusBar.running(config.executable);
    }
    this.logger.debug(`Linting ${filePath}`);
    const start = Date.now();

    const result = await task.run((signal) =>
      this.runner(
        content,
        filePath,
        config,
        cwd,
        vscode.workspace.isTrusted,
        signal,
      ),
    );

    // A newer lint was started while we were waiting — discard
    // these stale results.
    if (result === undefined) {
      this.logger.debug(`Discarding stale lint result for ${filePath}`);
      return;
    }

    // Guard: don't set diagnostics after dispose or doc close.
    if (this.disposed) {
      return;
    }

    const elapsed = Date.now() - start;
    if (result.command && result.args) {
      const quoted = result.args.map((a) =>
        /[\s"'\\]/.test(a) ? `'${a}'` : a,
      );
      this.logger.debug(`$ ${result.command} ${quoted.join(" ")}`);
    }
    this.logger.debug(
      `Exit code: ${result.exitCode ?? "N/A"}, ` +
        `errors: ${result.errors.length}, ` +
        `elapsed: ${elapsed}ms`,
    );
    if (result.stderr) {
      this.logger.debug(`stderr: ${result.stderr}`);
    }

    if (result.executionError) {
      this.logger.error(result.executionError);
      const isNotFound = result.executionError.includes("not found");
      if (isNotFound) {
        // "not installed" is a global concern — always show
        // and persist across editor switches.
        this.statusBar.notInstalled(config.executable);
      } else if (this.isActiveDocument(document)) {
        this.statusBar.idle(config.executable);
      }
      // Only show the error notification once per not-found
      // state. Other execution errors always notify.
      if (!isNotFound || !this._notInstalled) {
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
      }
      if (isNotFound) {
        this._notInstalled = true;
      }
      return;
    }

    if (result.warning) {
      this.logger.info(result.warning);
      this.diagnostics.set(document.uri, []);
      this._notInstalled = false;
      this._unexpectedOutput = true;

      // "unexpected output" is a global concern — always show
      // and persist across editor switches.
      this.statusBar.unexpectedOutput(config.executable);

      if (!this._unexpectedOutput) {
        this._unexpectedOutput = true;
        void Promise.resolve(
          vscode.window.showWarningMessage(
            `actionlint: ${result.warning}`,
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
      }
      return;
    }

    const wasGlobalWarning = this._notInstalled || this._unexpectedOutput;
    this._notInstalled = false;
    this._unexpectedOutput = false;
    const diags = toDiagnostics(result.errors);
    this.diagnostics.set(document.uri, diags);

    if (this.isActiveDocument(document)) {
      if (diags.length > 0) {
        this.statusBar.errors(diags.length, config.executable);
      } else {
        this.statusBar.idle(config.executable);
      }
    } else if (wasGlobalWarning) {
      // Global warning states were set globally, so clear
      // them globally even when the linted document isn't
      // the active editor.
      this.statusBar.idle(config.executable);
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
    for (const task of this.tasks.values()) {
      task.cancel();
    }
    this.tasks.clear();
    for (const d of this.permanentDisposables) {
      d.dispose();
    }
    this.diagnostics.dispose();
  }
}
