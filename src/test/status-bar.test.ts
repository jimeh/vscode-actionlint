import * as assert from "assert";
import * as vscode from "vscode";
import { StatusBar } from "../status-bar";

suite("StatusBar", () => {
  let statusBar: StatusBar;

  setup(() => {
    statusBar = new StatusBar();
  });

  teardown(() => {
    statusBar.dispose();
  });

  test("initial state is idle", () => {
    assert.strictEqual(statusBar.state, "idle");
  });

  test("running() sets state to running", () => {
    statusBar.running("actionlint");
    assert.strictEqual(statusBar.state, "running");
  });

  test("running() without arg sets state to running", () => {
    statusBar.running();
    assert.strictEqual(statusBar.state, "running");
  });

  test("hide() sets state to hidden", () => {
    statusBar.hide();
    assert.strictEqual(statusBar.state, "hidden");
  });

  test("idle → running → idle cycle", () => {
    assert.strictEqual(statusBar.state, "idle");
    statusBar.running();
    assert.strictEqual(statusBar.state, "running");
    statusBar.idle();
    assert.strictEqual(statusBar.state, "idle");
  });

  test("idle → notInstalled → idle cycle", () => {
    assert.strictEqual(statusBar.state, "idle");
    statusBar.notInstalled("/usr/bin/actionlint");
    assert.strictEqual(statusBar.state, "notInstalled");
    statusBar.idle();
    assert.strictEqual(statusBar.state, "idle");
  });

  test("idle → unexpectedOutput → idle cycle", () => {
    assert.strictEqual(statusBar.state, "idle");
    statusBar.unexpectedOutput();
    assert.strictEqual(statusBar.state, "unexpectedOutput");
    statusBar.idle();
    assert.strictEqual(statusBar.state, "idle");
  });

  test("hide → idle restores state", () => {
    statusBar.hide();
    assert.strictEqual(statusBar.state, "hidden");
    statusBar.idle();
    assert.strictEqual(statusBar.state, "idle");
  });

  test("tooltips are untrusted markdown", () => {
    statusBar.notInstalled("actionlint`](command:evil)");
    const item = (statusBar as unknown as { item: vscode.StatusBarItem }).item;
    const tooltip = item.tooltip as vscode.MarkdownString;

    assert.ok(tooltip instanceof vscode.MarkdownString);
    assert.notStrictEqual(tooltip.isTrusted, true);
  });

  test("tooltip links to config file when present", () => {
    statusBar.idle("actionlint", [
      {
        name: "my-project",
        folderUri: "file:///home/user/my-project",
        hasConfig: true,
        configFile: "actionlint.yml",
        configUri: "file:///home/user/my-project/.github/actionlint.yml",
      },
    ]);
    const item = (statusBar as unknown as { item: vscode.StatusBarItem }).item;
    const tooltip = item.tooltip as vscode.MarkdownString;

    assert.ok(
      tooltip.value.includes("command:vscode.open"),
      "Should contain vscode.open command link",
    );
    assert.ok(
      tooltip.value.includes(".github/actionlint.yml"),
      "Should show actual config filename",
    );
    const trusted = tooltip.isTrusted as {
      enabledCommands: string[];
    };
    assert.ok(
      trusted.enabledCommands.includes("vscode.open"),
      "isTrusted should include vscode.open",
    );
  });

  test("tooltip links to init-config when config missing", () => {
    statusBar.idle("actionlint", [
      {
        name: "my-project",
        folderUri: "file:///home/user/my-project",
        hasConfig: false,
      },
    ]);
    const item = (statusBar as unknown as { item: vscode.StatusBarItem }).item;
    const tooltip = item.tooltip as vscode.MarkdownString;

    assert.ok(
      tooltip.value.includes("command:actionlint.initConfig"),
      "Should contain initConfig command link",
    );
    assert.ok(
      !tooltip.value.includes("command:vscode.open"),
      "Should not contain vscode.open link",
    );
  });

  test("multi-root tooltip shows per-folder config links", () => {
    statusBar.idle("actionlint", [
      {
        name: "app",
        folderUri: "file:///home/user/app",
        hasConfig: true,
        configFile: "actionlint.yaml",
        configUri: "file:///home/user/app/.github/actionlint.yaml",
      },
      {
        name: "lib",
        folderUri: "file:///home/user/lib",
        hasConfig: false,
      },
    ]);
    const item = (statusBar as unknown as { item: vscode.StatusBarItem }).item;
    const tooltip = item.tooltip as vscode.MarkdownString;

    assert.ok(
      tooltip.value.includes("command:vscode.open"),
      "Should contain vscode.open for folder with config",
    );
    assert.ok(
      tooltip.value.includes("command:actionlint.initConfig"),
      "Should contain initConfig for folder without config",
    );
    const trusted = tooltip.isTrusted as {
      enabledCommands: string[];
    };
    assert.ok(
      trusted.enabledCommands.includes("vscode.open"),
      "isTrusted should include vscode.open",
    );
    assert.ok(
      trusted.enabledCommands.includes("actionlint.initConfig"),
      "isTrusted should include actionlint.initConfig",
    );
  });

  test("config file link falls back when URI missing", () => {
    statusBar.idle("actionlint", [
      {
        name: "my-project",
        folderUri: "file:///home/user/my-project",
        hasConfig: true,
        configFile: "actionlint.yaml",
        // no configUri
      },
    ]);
    const item = (statusBar as unknown as { item: vscode.StatusBarItem }).item;
    const tooltip = item.tooltip as vscode.MarkdownString;

    assert.ok(
      !tooltip.value.includes("command:vscode.open"),
      "Should not contain vscode.open without URI",
    );
    assert.ok(
      tooltip.value.includes("`.github/actionlint.yaml`"),
      "Should show config filename as inline code",
    );
  });

  test("dispose does not throw", () => {
    // Dispose is called in teardown, but test explicit call.
    statusBar.dispose();
    // Create a new one for teardown to dispose.
    statusBar = new StatusBar();
  });
});
