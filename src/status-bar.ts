import * as vscode from "vscode";

/** Per-folder config file status for multi-root workspaces. */
export interface WorkspaceConfigStatus {
  /** Display name of the workspace folder. */
  name: string;
  /** Folder URI string (passed to initConfig command). */
  folderUri: string;
  /** Whether the folder has a `.github/actionlint.{yaml,yml}` file. */
  hasConfig: boolean;
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
    this._state = "notInstalled";
    this.item.text = "$(warning) actionlint";
    this.item.tooltip = this.buildWarningTooltip(
      "Binary not found",
      "[Install actionlint]" +
        "(https://github.com/rhysd/actionlint" +
        "/blob/main/docs/install.md)" +
        " or update `actionlint.executable`" +
        " in settings.",
      executable,
      configStatus,
    );
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    this.item.show();
  }

  /** Show warning that actionlint produced unexpected output. */
  unexpectedOutput(
    executable?: string,
    configStatus?: WorkspaceConfigStatus[],
  ): void {
    this._state = "unexpectedOutput";
    this.item.text = "$(warning) actionlint";
    this.item.tooltip = this.buildWarningTooltip(
      "Unexpected output",
      "The executable exited with errors but produced " +
        "no lint output. This may indicate it is a shim " +
        "that failed to run actionlint.\n\n" +
        'Set `actionlint.logLevel` to `"debug"` for details.',
      executable,
      configStatus,
    );
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    this.item.show();
  }

  /** Hide the status bar item. */
  hide(): void {
    this._state = "hidden";
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
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

    const needsCommand = configStatus.some((s) => !s.hasConfig);
    if (needsCommand) {
      md.isTrusted = {
        enabledCommands: ["actionlint.initConfig"],
      };
    }

    const single = configStatus.length === 1 ? configStatus[0] : undefined;
    if (single) {
      if (single.hasConfig) {
        md.appendMarkdown("\n\nConfig: `.github/actionlint.yaml`");
      } else {
        md.appendMarkdown(
          "\n\nConfig: " + this.initConfigLink(single.folderUri),
        );
      }
      return;
    }

    md.appendMarkdown("\n\nConfig:");
    for (const entry of configStatus) {
      if (entry.hasConfig) {
        md.appendMarkdown("\n- **");
        md.appendText(entry.name);
        md.appendMarkdown("**: `.github/actionlint.yaml`");
      } else {
        md.appendMarkdown("\n- **");
        md.appendText(entry.name);
        md.appendMarkdown("**: " + this.initConfigLink(entry.folderUri));
      }
    }
  }

  /** Build a command link for `actionlint.initConfig`. */
  private initConfigLink(folderUri: string): string {
    const args = encodeURIComponent(JSON.stringify([folderUri]));
    return "[Initialize config]" + `(command:actionlint.initConfig?${args})`;
  }
}
