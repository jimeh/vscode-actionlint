import * as vscode from "vscode";

/** Observable status bar states for testing. */
export type StatusBarState =
  | "idle"
  | "running"
  | "errors"
  | "notInstalled"
  | "hidden";

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
  idle(): void {
    this._state = "idle";
    this.item.text = "$(check) actionlint";
    this.item.tooltip = "actionlint: no issues";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show spinner while actionlint is running. */
  running(): void {
    this._state = "running";
    this.item.text = "$(sync~spin) actionlint";
    this.item.tooltip = "actionlint: running...";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /** Show error count. */
  errors(count: number): void {
    this._state = "errors";
    this.item.text = `$(error) actionlint: ${count}`;
    this.item.tooltip = `actionlint: ${count} issue${count !== 1 ? "s" : ""} found`;
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
    this.item.show();
  }

  /** Show warning that actionlint is not installed. */
  notInstalled(): void {
    this._state = "notInstalled";
    this.item.text = "$(warning) actionlint";
    this.item.tooltip = "actionlint: binary not found";
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
}
