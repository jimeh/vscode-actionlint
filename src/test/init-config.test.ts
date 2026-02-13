import * as assert from "assert";
import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getConfig } from "../config";
import { sleep } from "./helpers";

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

/** Poll until the active editor matches a path suffix. */
async function waitForEditor(
  suffix: string,
  timeoutMs = 2000,
): Promise<vscode.TextEditor> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.fsPath.endsWith(suffix)) {
      return editor;
    }
    await sleep(50);
  }
  const current = vscode.window.activeTextEditor;
  throw new assert.AssertionError({
    message:
      `Timed out waiting for editor with suffix "${suffix}". ` +
      `Current: ${current?.document.uri.fsPath ?? "(none)"}`,
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
    await sleep(1000);

    assert.ok(fs.existsSync(configPath), "Config file should be created");

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
    await sleep(1000);

    assert.ok(
      fs.existsSync(workflowsDir),
      ".github/workflows/ should be created",
    );
    assert.ok(fs.existsSync(configPath), "Config file should be created");
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

    await vscode.commands.executeCommand(
      "actionlint.initConfig",
      getFixtureFolderUri(),
    );
    await sleep(500);

    assert.ok(
      !fs.existsSync(configPath),
      "Config should NOT be created with bad executable",
    );
  });
});
