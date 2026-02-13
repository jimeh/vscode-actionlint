import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { CancellableTask } from "./cancellable-task";
import { getConfig } from "./config";
import { toDiagnostics } from "./diagnostics";
import type { Logger } from "./logger";
import { runActionlint, type RunResult } from "./runner";
import type { StatusBar, WorkspaceConfigStatus } from "./status-bar";
import type { ActionlintConfig, RunActionlint } from "./types";
import { debounce, isActionlintConfigFile, isWorkflowFile } from "./utils";

/** Debounced function type with cancel capability. */
type DebouncedFn = ((doc: vscode.TextDocument) => void) & { cancel(): void };

/** Per-document state: lint task and optional debounce function. */
type DocState = {
  task: CancellableTask;
  debounce?: DebouncedFn;
};

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
   * Per-document state: cancellable lint task and optional
   * debounce function. Keyed by document URI string.
   */
  private docs = new Map<string, DocState>();

  /**
   * Disposables for trigger-specific listeners (save/change).
   * Rebuilt when configuration changes.
   */
  private triggerDisposables: vscode.Disposable[] = [];

  /** Permanent disposables (config change, close, open). */
  private permanentDisposables: vscode.Disposable[] = [];

  /** Set to true after dispose() is called. */
  private disposed = false;

  /** Cached per-folder config status. */
  private _configStatusCache?: WorkspaceConfigStatus[];

  /**
   * Tracks global warning state for the actionlint binary.
   * "notInstalled" and "unexpectedOutput" are mutually
   * exclusive; "none" means no global warning is active.
   */
  private _globalWarning: "none" | "notInstalled" | "unexpectedOutput" = "none";

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
          this.invalidateConfigStatusCache();
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

    // Watch for config file changes to invalidate the cache.
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      "**/.github/actionlint.{yaml,yml}",
    );
    configWatcher.onDidCreate(() => {
      this.invalidateConfigStatusCache();
    });
    configWatcher.onDidChange(() => {
      this.invalidateConfigStatusCache();
    });
    configWatcher.onDidDelete(() => {
      this.invalidateConfigStatusCache();
    });
    this.permanentDisposables.push(configWatcher);

    // Workspace folder changes affect config status.
    this.permanentDisposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.invalidateConfigStatusCache();
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
    const config = getConfig();
    if (!editor || !config.enable) {
      this.statusBar.hide();
      return;
    }
    if (
      !isWorkflowFile(editor.document) &&
      !isActionlintConfigFile(editor.document)
    ) {
      this.statusBar.hide();
      return;
    }

    this.resolveStatusBarState(config);
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
          const state = this.getDocState(key);
          if (!state.debounce) {
            state.debounce = debounce((doc: vscode.TextDocument) => {
              this.lintDocument(doc);
            }, config.debounceDelay);
          }
          state.debounce(e.document);
        }),
      );
    }
  }

  private disposeTriggerListeners(): void {
    for (const state of this.docs.values()) {
      state.debounce?.cancel();
      state.debounce = undefined;
    }
    for (const d of this.triggerDisposables) {
      d.dispose();
    }
    this.triggerDisposables = [];
  }

  /**
   * Clean up per-document state (debounce, cancellable task).
   */
  private cleanupDocument(key: string): void {
    const state = this.docs.get(key);
    if (state) {
      state.debounce?.cancel();
      state.task.cancel();
    }
    this.docs.delete(key);
  }

  /** Get or create a {@link DocState} for a document key. */
  private getDocState(key: string): DocState {
    let state = this.docs.get(key);
    if (!state) {
      state = { task: new CancellableTask() };
      this.docs.set(key, state);
    }
    return state;
  }

  /** Check whether a document is the active editor's document. */
  private isActiveDocument(doc: vscode.TextDocument): boolean {
    const active = vscode.window.activeTextEditor;
    return (
      active !== undefined &&
      active.document.uri.toString() === doc.uri.toString()
    );
  }

  /** Show an error or warning notification with "Show Output" action. */
  private showNotification(level: "error" | "warning", message: string): void {
    const show =
      level === "error"
        ? vscode.window.showErrorMessage
        : vscode.window.showWarningMessage;
    void Promise.resolve(show(`actionlint: ${message}`, "Show Output")).then(
      (choice) => {
        if (choice === "Show Output") {
          this.logger.show();
        }
      },
      () => {},
    );
  }

  /**
   * Update status bar after a lint completes. Global warnings
   * always update; per-document states only update for the active
   * document or when clearing a previously-set global warning.
   */
  private updateStatusBarAfterLint(
    doc: vscode.TextDocument,
    config: ActionlintConfig,
    hadGlobalWarning: boolean,
  ): void {
    if (this._globalWarning !== "none") {
      this.resolveStatusBarState(config);
      return;
    }
    if (!this.isActiveDocument(doc) && !hadGlobalWarning) {
      return;
    }
    this.resolveStatusBarState(config);
  }

  /**
   * Resolve the current status bar state from global warnings
   * and per-document diagnostics.
   */
  private resolveStatusBarState(config: ActionlintConfig): void {
    const configStatus = this.getWorkspaceConfigStatus();
    if (this._globalWarning === "notInstalled") {
      this.statusBar.notInstalled(config.executable, configStatus);
    } else if (this._globalWarning === "unexpectedOutput") {
      this.statusBar.unexpectedOutput(config.executable, configStatus);
    } else {
      this.statusBar.idle(config.executable, configStatus);
    }
  }

  /**
   * Clear the config status cache and refresh the status bar
   * tooltip for the active editor.
   */
  private invalidateConfigStatusCache(): void {
    this._configStatusCache = undefined;
    this.updateStatusBarForEditor(vscode.window.activeTextEditor);
  }

  /**
   * Build per-folder config status for all workspace folders.
   * Each entry indicates whether `.github/actionlint.{yaml,yml}`
   * exists in that folder. Results are cached until invalidated
   * by file system or configuration changes.
   */
  private getWorkspaceConfigStatus(): WorkspaceConfigStatus[] {
    if (this._configStatusCache) {
      return this._configStatusCache;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return [];
    }
    this._configStatusCache = folders.map((folder) => {
      const dir = path.join(folder.uri.fsPath, ".github");
      // Check .yaml first, then .yml.
      for (const ext of ["yaml", "yml"] as const) {
        const file = path.join(dir, `actionlint.${ext}`);
        if (fs.existsSync(file)) {
          return {
            name: folder.name,
            folderUri: folder.uri.toString(),
            hasConfig: true,
            configFile: `actionlint.${ext}`,
            configUri: vscode.Uri.file(file).toString(),
          };
        }
      }
      return {
        name: folder.name,
        folderUri: folder.uri.toString(),
        hasConfig: false,
      };
    });
    return this._configStatusCache;
  }

  /**
   * Process a completed lint result: log details, update flags,
   * set diagnostics, and update the status bar.
   */
  private processResult(
    document: vscode.TextDocument,
    config: ActionlintConfig,
    filePath: string,
    result: RunResult,
    elapsed: number,
  ): void {
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

    const hadGlobalWarning = this._globalWarning !== "none";

    if (result.executionError) {
      this.logger.error(result.executionError);
      const isNotFound = result.executionError.includes("not found");
      // Only show the error notification once per not-found
      // state. Other execution errors always notify.
      if (!isNotFound || this._globalWarning !== "notInstalled") {
        this.showNotification("error", result.executionError);
      }
      if (isNotFound) {
        this._globalWarning = "notInstalled";
      }
      this.updateStatusBarAfterLint(document, config, hadGlobalWarning);
      return;
    }

    if (result.warning) {
      this.logger.info(result.warning);
      this.diagnostics.set(document.uri, []);
      if (this._globalWarning !== "unexpectedOutput") {
        this._globalWarning = "unexpectedOutput";
        this.showNotification("warning", result.warning);
      }
      this.updateStatusBarAfterLint(document, config, hadGlobalWarning);
      return;
    }

    this._globalWarning = "none";
    const diags = toDiagnostics(result.errors);
    this.diagnostics.set(document.uri, diags);
    this.updateStatusBarAfterLint(document, config, hadGlobalWarning);

    if (diags.length > 0) {
      this.logger.info(
        `${filePath}: ${diags.length} ` +
          `issue${diags.length !== 1 ? "s" : ""}`,
      );
    }
  }

  /**
   * Get diagnostics for a URI from this linter's collection only.
   * Returns an empty array when the URI has no diagnostics or
   * after the linter has been disposed.
   */
  getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    if (this.disposed) {
      return [];
    }
    return this.diagnostics.get(uri) ?? [];
  }

  async lintDocument(document: vscode.TextDocument): Promise<void> {
    const config = getConfig();

    if (!config.enable) {
      this.diagnostics.delete(document.uri);
      if (this.isActiveDocument(document)) {
        this.statusBar.hide();
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

    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const cwd =
        workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);

      const key = document.uri.toString();
      const task = this.getDocState(key).task;

      const content = document.getText();
      const filePath = workspaceFolder
        ? path
            .relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
            .replace(/\\/g, "/")
        : vscode.workspace.asRelativePath(document.uri, false);

      if (this.isActiveDocument(document)) {
        this.statusBar.running(
          config.executable,
          this.getWorkspaceConfigStatus(),
        );
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

      // A newer lint was started while we were waiting —
      // discard these stale results.
      if (result === undefined) {
        this.logger.debug(`Discarding stale lint result for ${filePath}`);
        return;
      }

      // Guard: don't set diagnostics after dispose or doc close.
      if (this.disposed) {
        return;
      }

      this.processResult(
        document,
        config,
        filePath,
        result,
        Date.now() - start,
      );
    } catch (err) {
      this.logger.error(
        `Unexpected error linting ${document.uri.toString()}: ${err}`,
      );
      if (!this.disposed && this.isActiveDocument(document)) {
        this.resolveStatusBarState(config);
      }
    }
  }

  private lintOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      this.lintDocument(doc);
    }
  }

  dispose(): void {
    this.disposed = true;
    this._configStatusCache = undefined;
    this.disposeTriggerListeners();
    for (const state of this.docs.values()) {
      state.task.cancel();
    }
    this.docs.clear();
    for (const d of this.permanentDisposables) {
      d.dispose();
    }
    this.diagnostics.dispose();
  }
}
