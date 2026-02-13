import * as vscode from "vscode";

/** Per-folder config file status for multi-root workspaces. */
export interface WorkspaceConfigStatus {
  /** Display name of the workspace folder. */
  name: string;
  /** Folder URI string (passed to initConfig command). */
  folderUri: string;
  /** Whether the folder has a `.github/actionlint.{yaml,yml}` file. */
  hasConfig: boolean;
  /** Basename of the config file when present (e.g. `"actionlint.yml"`). */
  configFile?: string;
  /** Full file URI string for opening the config file. */
  configUri?: string;
}

/** Observable status bar states for testing. */
export type StatusBarState =
  | "idle"
  | "running"
  | "notInstalled"
  | "unexpectedOutput"
  | "hidden";

/**
 * Manages a status bar item that shows actionlint state.
 *
 * States:
 * - idle:              $(check) actionlint
 * - running:           $(sync~spin) actionlint
 * - not installed:     $(warning) actionlint
 * - unexpected output: $(warning) actionlint
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly onClickCommand = "actionlint.showOutput";
  private _state: StatusBarState = "idle";

  /** Current observable state. */
  get state(): StatusBarState {
    return this._state;
  }

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      0,
    );
    this.item.command = this.onClickCommand;
    this.idle();
  }

  /** Show idle state (no errors, not running). */
  idle(executable?: string, configStatus?: WorkspaceConfigStatus[]): void {
    this._state = "idle";
    this.item.text = "$(check) actionlint";
    this.item.tooltip = this.buildTooltip(
      "No issues",
      executable,
      configStatus,
    );
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show spinner while actionlint is running. */
  running(executable?: string, configStatus?: WorkspaceConfigStatus[]): void {
    this._state = "running";
    this.item.text = "$(sync~spin) actionlint";
    this.item.tooltip = this.buildTooltip(
      "Running...",
      executable,
      configStatus,
    );
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show warning that actionlint is not installed. */
  notInstalled(
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): void {
    this.setWarningState(
      "notInstalled",
      "Binary not found",
      "[Install actionlint]" +
        "(https://github.com/rhysd/actionlint" +
        "/blob/main/docs/install.md)" +
        " or update `actionlint.executable`" +
        " in settings.",
      executable,
      configStatus,
    );
  }

  /** Show warning that actionlint produced unexpected output. */
  unexpectedOutput(
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): void {
    this.setWarningState(
      "unexpectedOutput",
      "Unexpected output",
      "The executable exited with errors but produced " +
        "no lint output. This may indicate it is a shim " +
        "that failed to run actionlint.\n\n" +
        'Set `actionlint.logLevel` to `"debug"` for details.',
      executable,
      configStatus,
    );
  }

  /** Hide the status bar item. */
  hide(): void {
    this._state = "hidden";
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }

  /** Shared implementation for warning states. */
  private setWarningState(
    state: "notInstalled" | "unexpectedOutput",
    title: string,
    body: string,
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): void {
    this._state = state;
    this.item.text = "$(warning) actionlint";
    this.item.tooltip = this.buildWarningTooltip(
      title,
      body,
      executable,
      configStatus,
    );
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    this.item.show();
  }

  /**
   * Build a MarkdownString tooltip with a status line
   * and optional binary path.
   */
  private buildTooltip(
    status: string,
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown("**actionlint** - ");
    md.appendText(status);
    md.appendMarkdown("\n\nBinary: `");
    md.appendText(executable || "actionlint");
    md.appendMarkdown("`");
    this.appendConfigSection(md, configStatus);
    return md;
  }

  /**
   * Build a MarkdownString tooltip for warning states
   * (notInstalled, unexpectedOutput).
   */
  private buildWarningTooltip(
    title: string,
    body: string,
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown("**actionlint** - ");
    md.appendText(title);
    md.appendMarkdown("\n\nConfigured: `");
    md.appendText(executable || "actionlint");
    md.appendMarkdown("`");
    this.appendConfigSection(md, configStatus);
    md.appendMarkdown("\n\n");
    md.appendMarkdown(body);
    return md;
  }

  /**
   * Append config file status section to a tooltip.
   * Single-folder: inline. Multi-root: per-folder list.
   */
  private appendConfigSection(
    md: vscode.MarkdownString,
    configStatus?: WorkspaceConfigStatus[],
  ): void {
    if (!configStatus || configStatus.length === 0) {
      return;
    }

    const enabledCommands: string[] = [];
    if (configStatus.some((s) => !s.hasConfig)) {
      enabledCommands.push("actionlint.initConfig");
    }
    if (configStatus.some((s) => s.hasConfig && s.configUri)) {
      enabledCommands.push("vscode.open");
    }
    if (enabledCommands.length > 0) {
      md.isTrusted = { enabledCommands };
    }

    const single = configStatus.length === 1 ? configStatus[0] : undefined;
    if (single) {
      md.appendMarkdown("\n\nConfig: ");
      if (single.hasConfig) {
        this.appendConfigFileLink(md, single);
      } else {
        this.appendInitConfigLink(md, single.folderUri);
      }
      return;
    }

    md.appendMarkdown("\n\nConfig:");
    for (const entry of configStatus) {
      md.appendMarkdown("\n- **");
      md.appendText(entry.name);
      md.appendMarkdown("**: ");
      if (entry.hasConfig) {
        this.appendConfigFileLink(md, entry);
      } else {
        this.appendInitConfigLink(md, entry.folderUri);
      }
    }
  }

  /**
   * Append a command link to open an existing config file.
   * Falls back to plain inline code if URI is missing.
   *
   * Uses appendText for user-controlled display text to prevent
   * markdown injection via crafted config filenames.
   */
  private appendConfigFileLink(
    md: vscode.MarkdownString,
    entry: WorkspaceConfigStatus,
  ): void {
    const name = entry.configFile ?? "actionlint.yaml";
    if (!entry.configUri) {
      md.appendMarkdown("`.github/");
      md.appendText(name);
      md.appendMarkdown("`");
      return;
    }
    const args = encodeURIComponent(JSON.stringify([entry.configUri]));
    md.appendMarkdown(`[.github/`);
    md.appendText(name);
    md.appendMarkdown(`](command:vscode.open?${args})`);
  }

  /**
   * Append a command link for `actionlint.initConfig`.
   */
  private appendInitConfigLink(
    md: vscode.MarkdownString,
    folderUri: string,
  ): void {
    const args = encodeURIComponent(JSON.stringify([folderUri]));
    md.appendMarkdown(
      `[Initialize config](command:actionlint.initConfig?${args})`,
    );
  }
}
