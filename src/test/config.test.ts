import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "../config";

suite("getConfig", () => {
  const configSection = vscode.workspace.getConfiguration("actionlint");

  teardown(async () => {
    const keys = [
      "executable",
      "shellcheckExecutable",
      "pyflakesExecutable",
      "additionalArgs",
    ] as const;
    for (const key of keys) {
      await configSection.update(
        key,
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await configSection.update(
        key,
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }

    // Remove transient workspace settings file created by
    // workspace-scoped config updates in these tests.
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return;
    }
    const vscodeDir = path.join(root, ".vscode");
    const settingsPath = path.join(vscodeDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
    }
    if (fs.existsSync(vscodeDir) && fs.readdirSync(vscodeDir).length === 0) {
      fs.rmdirSync(vscodeDir);
    }
  });

  test("untrusted mode ignores workspace executable override", async () => {
    await configSection.update(
      "executable",
      "/usr/bin/actionlint-global",
      vscode.ConfigurationTarget.Global,
    );
    await configSection.update(
      "executable",
      "./bin/actionlint-workspace",
      vscode.ConfigurationTarget.Workspace,
    );

    const trusted = getConfig(true);
    const untrusted = getConfig(false);

    assert.strictEqual(trusted.executable, "./bin/actionlint-workspace");
    assert.strictEqual(untrusted.executable, "/usr/bin/actionlint-global");
  });

  test("untrusted mode ignores workspace helper path overrides", async () => {
    await configSection.update(
      "shellcheckExecutable",
      "/usr/bin/shellcheck-global",
      vscode.ConfigurationTarget.Global,
    );
    await configSection.update(
      "pyflakesExecutable",
      "/usr/bin/pyflakes-global",
      vscode.ConfigurationTarget.Global,
    );
    await configSection.update(
      "shellcheckExecutable",
      "./bin/shellcheck-workspace",
      vscode.ConfigurationTarget.Workspace,
    );
    await configSection.update(
      "pyflakesExecutable",
      "./bin/pyflakes-workspace",
      vscode.ConfigurationTarget.Workspace,
    );

    const trusted = getConfig(true);
    const untrusted = getConfig(false);

    assert.strictEqual(
      trusted.shellcheckExecutable,
      "./bin/shellcheck-workspace",
    );
    assert.strictEqual(trusted.pyflakesExecutable, "./bin/pyflakes-workspace");
    assert.strictEqual(
      untrusted.shellcheckExecutable,
      "/usr/bin/shellcheck-global",
    );
    assert.strictEqual(
      untrusted.pyflakesExecutable,
      "/usr/bin/pyflakes-global",
    );
  });

  test("untrusted mode drops additional args", async () => {
    await configSection.update(
      "additionalArgs",
      ["-debug", "--color"],
      vscode.ConfigurationTarget.Global,
    );

    const trusted = getConfig(true);
    const untrusted = getConfig(false);

    assert.deepStrictEqual(trusted.additionalArgs, ["-debug", "--color"]);
    assert.deepStrictEqual(untrusted.additionalArgs, []);
  });
});
