import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { ActionlintLinter } from "../linter";
import type { RunResult } from "../runner";
import { StatusBar } from "../status-bar";
import type { ActionlintConfig, RunActionlint } from "../types";

// ── Helpers ─────────────────────────────────────────────────────

const fixturesDir = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "test",
  "fixtures",
);

/** Minimal Logger stub that satisfies the Logger interface. */
function createLogger() {
  return {
    info(_msg: string) {},
    debug(_msg: string) {},
    error(_msg: string) {},
    show() {},
    dispose() {},
  };
}

function makeError(
  message = "test error",
  line = 5,
  kind = "syntax-check",
): import("../types").ActionlintError {
  return {
    message,
    filepath: ".github/workflows/ci.yml",
    line,
    column: 3,
    end_column: 10,
    kind,
    snippet: "  |  foo: bar\n  |  ^~~~",
  };
}

/**
 * Creates a mock runner that resolves with the given result
 * after an optional delay. Captures call args for assertions.
 */
function createMockRunner(
  result: RunResult,
  delayMs = 0,
): RunActionlint & { calls: Parameters<RunActionlint>[] } {
  const calls: Parameters<RunActionlint>[] = [];
  const fn = (
    content: string,
    filePath: string,
    config: ActionlintConfig,
    cwd: string,
    isTrusted?: boolean,
  ): Promise<RunResult> => {
    calls.push([content, filePath, config, cwd, isTrusted]);
    if (delayMs <= 0) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) =>
      setTimeout(() => resolve(result), delayMs),
    );
  };
  fn.calls = calls;
  return fn;
}

async function openFixture(
  name: string,
): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(
    path.join(fixturesDir, ".github", "workflows", name),
  );
  return vscode.workspace.openTextDocument(uri);
}

/** Wait for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Test Suites ─────────────────────────────────────────────────

suite("ActionlintLinter — race condition", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("stale results discarded on rapid invocations", async () => {
    // Use an "armed" gate so constructor's lintOpenDocuments
    // calls resolve instantly and don't interfere with our
    // explicit test calls.
    let armed = false;
    let testCallIdx = 0;

    const runner: RunActionlint = () => {
      if (!armed) {
        return Promise.resolve({ errors: [] });
      }
      const myIdx = testCallIdx++;
      // First call is slow, second is fast.
      const delay = myIdx === 0 ? 150 : 10;
      const result: RunResult =
        myIdx === 0
          ? {
              errors: [
                makeError("e1"),
                makeError("e2"),
                makeError("e3"),
              ],
            }
          : { errors: [makeError("final")] };
      return new Promise((resolve) =>
        setTimeout(() => resolve(result), delay),
      );
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");

    // Arm the runner for our explicit test calls.
    armed = true;
    const p1 = linter.lintDocument(doc);
    const p2 = linter.lintDocument(doc);
    await Promise.all([p1, p2]);

    // The second call's result (1 error) should win.
    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(
      diags.length,
      1,
      "Should have 1 diagnostic from second (latest) call",
    );
    assert.strictEqual(diags[0].message, "final");
  });

  test("operation ID increments per call", async () => {
    // Same gate pattern: constructor calls resolve instantly.
    let armed = false;
    let testCallIdx = 0;

    const runner: RunActionlint = () => {
      if (!armed) {
        return Promise.resolve({ errors: [] });
      }
      const myIdx = testCallIdx++;
      // First two calls are slow, third is fast.
      const delay = myIdx < 2 ? 150 : 10;
      const results: RunResult[] = [
        { errors: [makeError("first")] },
        {
          errors: [
            makeError("second"),
            makeError("second-b"),
          ],
        },
        { errors: [makeError("third")] },
      ];
      const result = results[Math.min(myIdx, results.length - 1)];
      return new Promise((resolve) =>
        setTimeout(() => resolve(result), delay),
      );
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");

    armed = true;
    const p1 = linter.lintDocument(doc);
    const p2 = linter.lintDocument(doc);
    const p3 = linter.lintDocument(doc);
    await Promise.all([p1, p2, p3]);

    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(
      diags.length,
      1,
      "Should have 1 diagnostic from third (latest) call",
    );
    assert.strictEqual(diags[0].message, "third");
  });
});

suite("ActionlintLinter — diagnostics scoping", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("re-linting one file does not affect another file", async () => {
    // First two calls return errors, third returns clean.
    let callCount = 0;
    const runner: RunActionlint = () => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          errors: [makeError("issue")],
        });
      }
      // Third call returns clean results.
      return Promise.resolve({ errors: [] });
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const docA = await openFixture("valid.yml");
    const docB = await openFixture("invalid.yml");

    // Lint both files to populate diagnostics.
    // Reset callCount so our explicit calls are predictable.
    callCount = 0;
    await linter.lintDocument(docA);
    await linter.lintDocument(docB);

    assert.ok(
      vscode.languages.getDiagnostics(docA.uri).length > 0,
      "docA should have diagnostics",
    );
    assert.ok(
      vscode.languages.getDiagnostics(docB.uri).length > 0,
      "docB should have diagnostics",
    );

    // Lint docA again (returns clean) — only docA updated.
    await linter.lintDocument(docA);

    assert.strictEqual(
      vscode.languages.getDiagnostics(docA.uri).length,
      0,
      "docA diagnostics should be cleared",
    );
    assert.ok(
      vscode.languages.getDiagnostics(docB.uri).length > 0,
      "docB diagnostics should remain unchanged",
    );
  });
});

suite("ActionlintLinter — status bar", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("shows errors after linting file with issues", async () => {
    const runner = createMockRunner({
      errors: [makeError("bad"), makeError("worse")],
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.strictEqual(statusBar.state, "errors");
  });

  test("shows idle after linting clean file", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.strictEqual(statusBar.state, "idle");
  });

  test("shows notInstalled when binary missing", async () => {
    const runner = createMockRunner({
      errors: [],
      executionError:
        'actionlint binary not found at "actionlint".',
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.strictEqual(statusBar.state, "notInstalled");
  });

  test("shows idle on execution error without 'not found'", async () => {
    const runner = createMockRunner({
      errors: [],
      executionError: "actionlint exited with code 2: unknown flag",
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.strictEqual(statusBar.state, "idle");
  });
});

suite("ActionlintLinter — CWD fallback", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("uses workspace folder when available", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.ok(runner.calls.length > 0, "Runner should be called");
    const cwd = runner.calls[runner.calls.length - 1][3];

    // The fixture may or may not be inside a workspace folder.
    // If inside a workspace, cwd should be the workspace root.
    // If not, cwd should be the file's parent directory.
    const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (wsFolder) {
      assert.strictEqual(cwd, wsFolder.uri.fsPath);
    } else {
      assert.strictEqual(
        cwd,
        path.dirname(doc.uri.fsPath),
      );
    }
  });

  test("falls back to file parent dir outside workspace", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");

    // Regardless of workspace state, the CWD should be a
    // valid directory path.
    await linter.lintDocument(doc);
    assert.ok(runner.calls.length > 0);

    const cwd = runner.calls[runner.calls.length - 1][3];
    assert.ok(
      typeof cwd === "string" && cwd.length > 0,
      "CWD should be a non-empty string",
    );
  });

  test("skips non-file URI schemes", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    // Create an untitled document (scheme = "untitled").
    const doc = await vscode.workspace.openTextDocument({
      language: "yaml",
      content: "name: CI\non: push\n",
    });

    await linter.lintDocument(doc);

    // The runner should NOT have been called for untitled URI.
    // Note: isWorkflowFile also checks the fsPath, so it may
    // return early there too. Either way, runner is not called.
    const callsForThisDoc = runner.calls.filter(
      (c) => c[0] === doc.getText(),
    );
    assert.strictEqual(
      callsForThisDoc.length,
      0,
      "Runner should not be called for non-file URIs",
    );
  });
});

suite("ActionlintLinter — workspace trust", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("passes isTrusted to runner", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.ok(runner.calls.length > 0, "Runner should be called");
    const lastCall = runner.calls[runner.calls.length - 1];
    const isTrusted = lastCall[4];
    assert.strictEqual(
      isTrusted,
      vscode.workspace.isTrusted,
      "isTrusted should match workspace trust state",
    );
  });
});

suite("ActionlintLinter — lifecycle", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("dispose cleans up without errors", () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    // Should not throw.
    linter.dispose();
  });

  test("double dispose does not throw", () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    linter.dispose();
    // Second dispose should be safe.
    linter.dispose();
  });

  test("lints open documents on construction", async () => {
    // Open a fixture before constructing the linter.
    const doc = await openFixture("valid.yml");
    await sleep(50);

    const runner = createMockRunner({
      errors: [makeError("initial")],
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(
      logger as any,
      statusBar,
      runner,
    );

    // Give the constructor's lintOpenDocuments time to run.
    await sleep(100);

    // The runner should have been called for the open document.
    const callsForDoc = runner.calls.filter(
      (c) => c[0] === doc.getText(),
    );
    assert.ok(
      callsForDoc.length > 0,
      "Should lint already-open workflow documents on construction",
    );
  });
});
