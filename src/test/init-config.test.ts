import * as assert from "assert";
import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "../config";
import { sleep, waitFor } from "./helpers";

const fixturesDir = path.join(__dirname, "..", "..", "src", "test", "fixtures");
const ghDir = path.join(fixturesDir, ".github");
const configPath = path.join(ghDir, "actionlint.yaml");
const configBak = configPath + ".bak";
const workflowsDir = path.join(ghDir, "workflows");
const workflowsBak = workflowsDir + ".bak";
const fixtureGitDir = path.join(fixturesDir, ".git");

/** Get the first workspace folder URI string, or throw. */
function getFixtureFolderUri(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Need a workspace folder");
  }
  return folder.uri.toString();
}

/** Check whether the actionlint binary is available. */
function hasActionlint(): boolean {
  try {
    execFileSync(getConfig().executable, ["--version"], {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a temporary git repo in the fixture directory so
 * `actionlint -init-config` targets it as the git root instead
 * of the parent project repo.
 */
function initFixtureGitRepo(): void {
  execSync("git init", { cwd: fixturesDir, stdio: "ignore" });
}

/** Remove the temporary git repo from the fixture directory. */
function cleanupFixtureGitRepo(): void {
  if (fs.existsSync(fixtureGitDir)) {
    fs.rmSync(fixtureGitDir, { recursive: true, force: true });
  }
}

/**
 * Poll until an editor matching a path suffix is visible.
 * Checks the active editor first, then falls back to all
 * visible editors — in the test environment another panel
 * (e.g. the task runner) can steal active focus after
 * showTextDocument completes.
 */
async function waitForEditor(
  suffix: string,
  timeoutMs = 5000,
): Promise<vscode.TextEditor> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const active = vscode.window.activeTextEditor;
    if (active?.document.uri.fsPath.endsWith(suffix)) {
      return active;
    }
    for (const ve of vscode.window.visibleTextEditors) {
      if (ve.document.uri.fsPath.endsWith(suffix)) {
        return ve;
      }
    }
    await sleep(50);
  }
  const current = vscode.window.activeTextEditor;
  const visible = vscode.window.visibleTextEditors
    .map((e) => e.document.uri.fsPath)
    .join(", ");
  throw new assert.AssertionError({
    message:
      `Timed out waiting for editor with suffix "${suffix}". ` +
      `Active: ${current?.document.uri.fsPath ?? "(none)"}` +
      `, Visible: [${visible}]`,
  });
}

suite("initConfig — opens existing config", () => {
  test("opens existing config file without re-running init", async () => {
    // The fixture already has .github/actionlint.yaml.
    assert.ok(fs.existsSync(configPath), "Fixture config should exist");

    // Pass folderUri to avoid workspace picker ambiguity.
    await vscode.commands.executeCommand(
      "actionlint.initConfig",
      getFixtureFolderUri(),
    );

    const editor = await waitForEditor(path.join(".github", "actionlint.yaml"));
    assert.ok(
      editor.document.uri.fsPath.endsWith(
        path.join(".github", "actionlint.yaml"),
      ),
    );
  });
});

suite("initConfig — creates config", () => {
  const binaryAvailable = hasActionlint();

  setup(() => {
    if (fs.existsSync(configPath)) {
      fs.renameSync(configPath, configBak);
    }
    // Make the fixture dir its own git root so actionlint
    // -init-config creates the config here, not in the
    // parent project repo.
    initFixtureGitRepo();
  });

  teardown(() => {
    cleanupFixtureGitRepo();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    if (fs.existsSync(configBak)) {
      fs.renameSync(configBak, configPath);
    }
  });

  test("creates config when none exists", async function () {
    if (!binaryAvailable) {
      return this.skip();
    }

    assert.ok(
      !fs.existsSync(configPath),
      "Config should not exist after rename",
    );

    await vscode.commands.executeCommand(
      "actionlint.initConfig",
      getFixtureFolderUri(),
    );
    await waitFor(
      () => fs.existsSync(configPath),
      "Config file should be created",
    );

    const editor = await waitForEditor(path.join(".github", "actionlint.yaml"));
    assert.ok(
      editor.document.uri.fsPath.endsWith(
        path.join(".github", "actionlint.yaml"),
      ),
    );
  });
});

suite("initConfig — creates workflows dir", () => {
  setup(() => {
    if (fs.existsSync(configPath)) {
      fs.renameSync(configPath, configBak);
    }
    if (fs.existsSync(workflowsDir)) {
      fs.renameSync(workflowsDir, workflowsBak);
    }
    initFixtureGitRepo();
  });

  teardown(() => {
    cleanupFixtureGitRepo();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    // Restore workflows dir.
    if (fs.existsSync(workflowsBak)) {
      // Remove the (possibly empty) recreated dir first.
      if (
        fs.existsSync(workflowsDir) &&
        fs.readdirSync(workflowsDir).length === 0
      ) {
        fs.rmdirSync(workflowsDir);
      }
      fs.renameSync(workflowsBak, workflowsDir);
    }
    // Restore config backup.
    if (fs.existsSync(configBak)) {
      fs.renameSync(configBak, configPath);
    }
  });

  test("creates .github/workflows/ if missing", async function () {
    if (!hasActionlint()) {
      return this.skip();
    }

    assert.ok(
      !fs.existsSync(workflowsDir),
      "workflows/ should not exist after rename",
    );

    await vscode.commands.executeCommand(
      "actionlint.initConfig",
      getFixtureFolderUri(),
    );
    await waitFor(
      () => fs.existsSync(workflowsDir) && fs.existsSync(configPath),
      ".github/workflows/ and config file should be created",
    );
  });
});

suite("initConfig — error on bad executable", () => {
  const configSection = vscode.workspace.getConfiguration("actionlint");

  setup(async () => {
    if (fs.existsSync(configPath)) {
      fs.renameSync(configPath, configBak);
    }
    await configSection.update(
      "executable",
      "/nonexistent/actionlint",
      vscode.ConfigurationTarget.Global,
    );
  });

  teardown(async () => {
    await configSection.update(
      "executable",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
    if (fs.existsSync(configBak)) {
      fs.renameSync(configBak, configPath);
    }
  });

  test("does not create config with bad executable", async () => {
    assert.ok(
      !fs.existsSync(configPath),
      "Config should not exist after rename",
    );

    // executeCommand awaits the full initConfig handler, which
    // catches the spawn error and returns — no sleep needed.
    await vscode.commands.executeCommand(
      "actionlint.initConfig",
      getFixtureFolderUri(),
    );

    assert.ok(
      !fs.existsSync(configPath),
      "Config should NOT be created with bad executable",
    );
  });
});
