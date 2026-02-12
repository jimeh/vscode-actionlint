import * as vscode from "vscode";

/**
 * Manages a status bar item that shows actionlint state.
 *
 * States:
 * - idle:          $(check) actionlint
 * - running:       $(sync~spin) actionlint
 * - errors(n):     $(error) actionlint: N
 * - not installed: $(warning) actionlint
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly onClickCommand = "actionlint.showOutput";

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.item.command = this.onClickCommand;
    this.idle();
  }

  /** Show idle state (no errors, not running). */
  idle(): void {
    this.item.text = "$(check) actionlint";
    this.item.tooltip = "actionlint: no issues";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show spinner while actionlint is running. */
  running(): void {
    this.item.text = "$(sync~spin) actionlint";
    this.item.tooltip = "actionlint: running...";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show error count. */
  errors(count: number): void {
    this.item.text = `$(error) actionlint: ${count}`;
    this.item.tooltip = `actionlint: ${count} issue${count !== 1 ? "s" : ""} found`;
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
    this.item.show();
  }

  /** Show warning that actionlint is not installed. */
  notInstalled(): void {
    this.item.text = "$(warning) actionlint";
    this.item.tooltip = "actionlint: binary not found";
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    this.item.show();
  }

  /** Hide the status bar item. */
  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
