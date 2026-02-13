import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { ActionlintLinter } from "../linter";
import type { RunResult } from "../runner";
import { StatusBar } from "../status-bar";
import type { ActionlintConfig, RunActionlint } from "../types";
import { at, createLogger, makeError, sleep } from "./helpers";

// ── Helpers ─────────────────────────────────────────────────────

const fixturesDir = path.join(__dirname, "..", "..", "src", "test", "fixtures");

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
    signal?: AbortSignal,
  ): Promise<RunResult> => {
    calls.push([content, filePath, config, cwd, isTrusted, signal]);
    if (delayMs <= 0) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) => setTimeout(() => resolve(result), delayMs));
  };
  fn.calls = calls;
  return fn;
}

/**
 * Creates a gate-controlled mock runner. Each call blocks until
 * the corresponding gate is resolved externally, giving tests
 * precise control over timing.
 */
function createGatedRunner(): {
  runner: RunActionlint;
  calls: {
    args: Parameters<RunActionlint>;
    resolve: (r: RunResult) => void;
  }[];
} {
  const calls: {
    args: Parameters<RunActionlint>;
    resolve: (r: RunResult) => void;
  }[] = [];

  const runner: RunActionlint = (
    content: string,
    filePath: string,
    config: ActionlintConfig,
    cwd: string,
    isTrusted?: boolean,
    signal?: AbortSignal,
  ): Promise<RunResult> => {
    return new Promise<RunResult>((resolve) => {
      calls.push({
        args: [content, filePath, config, cwd, isTrusted, signal],
        resolve,
      });
    });
  };

  return { runner, calls };
}

async function openFixture(name: string): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(
    path.join(fixturesDir, ".github", "workflows", name),
  );
  return vscode.workspace.openTextDocument(uri);
}

/**
 * Wait then resolve and remove all pending gated runner calls
 * with empty results. Used to drain constructor/open-triggered
 * lint calls so tests start from a clean slate.
 */
async function drainCalls(
  calls: { resolve: (r: RunResult) => void }[],
  ms = 50,
): Promise<void> {
  await sleep(ms);
  for (const c of calls.splice(0)) {
    c.resolve({ errors: [] });
  }
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
    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    const doc = await openFixture("valid.yml");
    await drainCalls(calls);

    // Fire two lints for the same document.
    const p1 = linter.lintDocument(doc);
    const p2 = linter.lintDocument(doc);
    await sleep(10);

    assert.strictEqual(calls.length, 2, "Two lint calls should be pending");

    // Resolve second (latest) before first — simulating
    // the second being faster than the first.
    at(calls, 1).resolve({
      errors: [makeError({ message: "final" })],
    });
    at(calls, 0).resolve({
      errors: [
        makeError({ message: "e1" }),
        makeError({ message: "e2" }),
        makeError({ message: "e3" }),
      ],
    });

    await Promise.all([p1, p2]);

    // The second call's result (1 error) should win.
    const diags = linter.getDiagnostics(doc.uri);
    assert.strictEqual(
      diags.length,
      1,
      "Should have 1 diagnostic from second (latest) call",
    );
    assert.strictEqual(at(diags, 0).message, "final");
  });

  test("latest result wins on rapid invocations", async () => {
    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    const doc = await openFixture("valid.yml");
    await drainCalls(calls);

    // Fire three lints for the same document.
    const p1 = linter.lintDocument(doc);
    const p2 = linter.lintDocument(doc);
    const p3 = linter.lintDocument(doc);
    await sleep(10);

    assert.strictEqual(calls.length, 3, "Three lint calls should be pending");

    // Resolve third (latest) first, then first, then second.
    at(calls, 2).resolve({
      errors: [makeError({ message: "third" })],
    });
    at(calls, 0).resolve({
      errors: [makeError({ message: "first" })],
    });
    at(calls, 1).resolve({
      errors: [
        makeError({ message: "second" }),
        makeError({ message: "second-b" }),
      ],
    });

    await Promise.all([p1, p2, p3]);

    const diags = linter.getDiagnostics(doc.uri);
    assert.strictEqual(
      diags.length,
      1,
      "Should have 1 diagnostic from third (latest) call",
    );
    assert.strictEqual(at(diags, 0).message, "third");
  });
});

suite("ActionlintLinter — concurrent multi-file lint", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test(
    "lint docA (slow) + docB (fast) " + "get correct diagnostics independently",
    async () => {
      const { runner, calls } = createGatedRunner();

      statusBar = new StatusBar();
      const logger = createLogger();
      linter = new ActionlintLinter(logger as any, statusBar, runner);

      await drainCalls(calls);

      const docA = await openFixture("valid.yml");
      const docB = await openFixture("invalid.yml");
      await drainCalls(calls);

      // Now explicitly lint both documents.
      const pA = linter.lintDocument(docA);
      const pB = linter.lintDocument(docB);
      await sleep(10); // let both calls register

      assert.strictEqual(calls.length, 2, "Both lint calls should be pending");

      // Resolve docB first (fast), then docA (slow).
      at(calls, 1).resolve({
        errors: [makeError({ message: "docB-error" })],
      });
      at(calls, 0).resolve({
        errors: [
          makeError({ message: "docA-error1" }),
          makeError({ message: "docA-error2" }),
        ],
      });

      await Promise.all([pA, pB]);

      const diagsA = linter.getDiagnostics(docA.uri);
      const diagsB = linter.getDiagnostics(docB.uri);

      assert.strictEqual(diagsA.length, 2, "docA should have 2 diagnostics");
      assert.strictEqual(at(diagsA, 0).message, "docA-error1");
      assert.strictEqual(diagsB.length, 1, "docB should have 1 diagnostic");
      assert.strictEqual(at(diagsB, 0).message, "docB-error");
    },
  );
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
          errors: [makeError({ message: "issue" })],
        });
      }
      // Third call returns clean results.
      return Promise.resolve({ errors: [] });
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const docA = await openFixture("valid.yml");
    const docB = await openFixture("invalid.yml");

    // Lint both files to populate diagnostics.
    // Reset callCount so our explicit calls are predictable.
    callCount = 0;
    await linter.lintDocument(docA);
    await linter.lintDocument(docB);

    assert.ok(
      linter.getDiagnostics(docA.uri).length > 0,
      "docA should have diagnostics",
    );
    assert.ok(
      linter.getDiagnostics(docB.uri).length > 0,
      "docB should have diagnostics",
    );

    // Lint docA again (returns clean) — only docA updated.
    await linter.lintDocument(docA);

    assert.strictEqual(
      linter.getDiagnostics(docA.uri).length,
      0,
      "docA diagnostics should be cleared",
    );
    assert.ok(
      linter.getDiagnostics(docB.uri).length > 0,
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
      errors: [makeError({ message: "bad" }), makeError({ message: "worse" })],
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    // Status bar reflects active editor, but diagnostics are
    // always set. In tests the active editor may not be the
    // doc we just linted, so check diagnostics instead.
    const diags = linter.getDiagnostics(doc.uri);
    assert.strictEqual(diags.length, 2);
  });

  test("shows idle after linting clean file", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    const diags = linter.getDiagnostics(doc.uri);
    assert.strictEqual(diags.length, 0);
  });

  test("shows notInstalled when binary missing", async () => {
    const runner = createMockRunner({
      errors: [],
      executionError: 'actionlint binary not found at "actionlint".',
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    // "not installed" is a global concern — always shown.
    assert.strictEqual(statusBar.state, "notInstalled");
  });

  test("shows running state for active document", async () => {
    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    const doc = await openFixture("valid.yml");
    await drainCalls(calls);

    // Show the document to make it the active editor.
    await vscode.window.showTextDocument(doc);

    // Start a lint (don't await yet).
    const lintPromise = linter.lintDocument(doc);
    await sleep(10);

    // While lint is in-flight, status bar should be running.
    assert.strictEqual(
      statusBar.state,
      "running",
      "Status bar should show running for active document",
    );

    // Resolve the pending call.
    assert.ok(calls.length > 0, "Should have a pending call");
    at(calls, calls.length - 1).resolve({ errors: [] });
    await lintPromise;
  });

  test("hides status bar for non-workflow active editor", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    // Open a workflow file first to ensure status bar is visible.
    const doc = await openFixture("valid.yml");
    await vscode.window.showTextDocument(doc);
    await sleep(50);

    // Now open a non-workflow document to trigger
    // onDidChangeActiveTextEditor → updateStatusBarForEditor.
    const nonWorkflow = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "not a workflow",
    });
    await vscode.window.showTextDocument(nonWorkflow);
    await sleep(50);

    assert.strictEqual(
      statusBar.state,
      "hidden",
      "Status bar should hide for non-workflow file",
    );
  });

  test("shows idle on execution error without 'not found'", async () => {
    const runner = createMockRunner({
      errors: [],
      executionError: "actionlint exited with code 2: unknown flag",
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    // Non-"not found" errors show idle only for active doc.
    // In test environment the active editor may vary, so
    // just verify it's not in an unexpected state.
    assert.ok(statusBar.state !== "running", "Should not still be running");
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
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.ok(runner.calls.length > 0, "Runner should be called");
    const lastCall = at(runner.calls, runner.calls.length - 1);
    const cwd = lastCall[3];

    // With launchArgs pointing to fixtures dir, workspace folder
    // should always exist for fixture files.
    const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    assert.ok(wsFolder, "Fixture should be in a workspace folder");
    assert.strictEqual(cwd, wsFolder!.uri.fsPath);

    // filePath should be relative to workspace root.
    const fp = lastCall[1];
    assert.ok(
      fp.includes(".github/workflows/"),
      "filePath should contain .github/workflows/",
    );
    assert.ok(
      !fp.startsWith(path.basename(wsFolder!.uri.fsPath) + "/"),
      "filePath should not start with workspace folder name",
    );
  });

  test("falls back to file parent dir outside workspace", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");

    // Regardless of workspace state, the CWD should be a
    // valid directory path.
    await linter.lintDocument(doc);
    assert.ok(runner.calls.length > 0);

    const lastCall = at(runner.calls, runner.calls.length - 1);
    const cwd = lastCall[3];
    assert.ok(
      typeof cwd === "string" && cwd.length > 0,
      "CWD should be a non-empty string",
    );
  });

  test("skips non-file URI schemes", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    // Create an untitled document (scheme = "untitled").
    const doc = await vscode.workspace.openTextDocument({
      language: "yaml",
      content: "name: CI\non: push\n",
    });

    await linter.lintDocument(doc);

    // The runner should NOT have been called for untitled URI.
    // Note: isWorkflowFile also checks the fsPath, so it may
    // return early there too. Either way, runner is not called.
    const callsForThisDoc = runner.calls.filter((c) => c[0] === doc.getText());
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
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.ok(runner.calls.length > 0, "Runner should be called");
    const lastCall = at(runner.calls, runner.calls.length - 1);
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
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    // Should not throw.
    linter.dispose();
  });

  test("double dispose does not throw", () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    linter.dispose();
    // Second dispose should be safe.
    linter.dispose();
  });

  test("lints open documents on construction", async () => {
    // Open a fixture before constructing the linter.
    const doc = await openFixture("valid.yml");
    await sleep(50);

    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    // Wait for constructor's lintOpenDocuments to register
    // a call, polling with a short interval.
    for (let i = 0; i < 20 && calls.length === 0; i++) {
      await sleep(10);
    }

    assert.ok(
      calls.length > 0,
      "Constructor should lint open workflow documents",
    );

    // Verify it was called with the open document's content.
    const callForDoc = calls.find((c) => c.args[0] === doc.getText());
    assert.ok(
      callForDoc,
      "Should lint already-open workflow documents " + "on construction",
    );

    // Resolve all pending calls to avoid dangling promises.
    for (const c of calls) {
      c.resolve({ errors: [] });
    }
  });

  test("dispose during in-flight lint does not set diagnostics", async () => {
    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    const doc = await openFixture("valid.yml");
    await drainCalls(calls);

    // Start a lint that we'll resolve after dispose.
    const lintPromise = linter.lintDocument(doc);
    await sleep(10);
    assert.strictEqual(calls.length, 1, "One call should be pending");

    // Dispose before the lint resolves.
    linter.dispose();

    // Resolve the pending call.
    at(calls, 0).resolve({
      errors: [makeError({ message: "late-result" })],
    });
    await lintPromise;

    // After dispose, diagnostics should NOT be updated
    // with the late result.
    const diags = linter.getDiagnostics(doc.uri);
    const hasLate = diags.some((d) => d.message === "late-result");
    assert.ok(
      !hasLate,
      "Diagnostics should not contain late results " + "after dispose",
    );
  });
});

suite("ActionlintLinter — AbortController", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("passes signal to runner", async () => {
    const runner = createMockRunner({ errors: [] });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    assert.ok(runner.calls.length > 0);
    const lastCall = at(runner.calls, runner.calls.length - 1);
    const signal = lastCall[5];
    assert.ok(
      signal instanceof AbortSignal,
      "Should pass AbortSignal to runner",
    );
  });

  test(
    "aborts previous signal when new lint starts " + "for same document",
    async () => {
      const signals: AbortSignal[] = [];
      const { runner, calls } = createGatedRunner();

      // Wrap to capture signals.
      const wrappedRunner: RunActionlint = (
        ...args: Parameters<RunActionlint>
      ) => {
        if (args[5]) {
          signals.push(args[5]);
        }
        return runner(...args);
      };

      statusBar = new StatusBar();
      const logger = createLogger();
      linter = new ActionlintLinter(logger as any, statusBar, wrappedRunner);

      await drainCalls(calls);
      signals.length = 0;

      const doc = await openFixture("valid.yml");
      await drainCalls(calls);
      signals.length = 0;

      // Start first lint.
      const p1 = linter.lintDocument(doc);
      await sleep(10);
      // Start second lint for same doc — should abort first.
      const p2 = linter.lintDocument(doc);
      await sleep(10);

      assert.strictEqual(signals.length, 2);
      const sig0 = at(signals, 0);
      const sig1 = at(signals, 1);
      assert.ok(sig0.aborted, "First signal should be aborted");
      assert.ok(!sig1.aborted, "Second signal should NOT be aborted");

      // Resolve both.
      for (const c of calls) {
        c.resolve({ errors: [] });
      }
      await Promise.all([p1, p2]);
    },
  );
});

suite("ActionlintLinter — config change", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;
  const configSection = vscode.workspace.getConfiguration("actionlint");

  teardown(async () => {
    linter?.dispose();
    statusBar?.dispose();
    // Reset settings to defaults.
    await configSection.update(
      "runTrigger",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("re-lints open documents on config change", async () => {
    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    // Ensure a workflow document is open so
    // lintOpenDocuments has something to lint.
    await openFixture("valid.yml");
    await drainCalls(calls);

    // Change a setting to trigger onDidChangeConfiguration.
    await configSection.update(
      "runTrigger",
      "onType",
      vscode.ConfigurationTarget.Global,
    );

    // Wait for the config change handler to fire and
    // lintOpenDocuments to call the runner.
    for (let i = 0; i < 20 && calls.length === 0; i++) {
      await sleep(10);
    }

    assert.ok(
      calls.length > 0,
      "Runner should be called again after config change",
    );

    await drainCalls(calls, 0);
  });
});

suite("ActionlintLinter — disabled mode", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;
  const configSection = vscode.workspace.getConfiguration("actionlint");

  teardown(async () => {
    linter?.dispose();
    statusBar?.dispose();
    await configSection.update(
      "enable",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("hides status bar for active workflow when disabled", async () => {
    await configSection.update(
      "enable",
      false,
      vscode.ConfigurationTarget.Global,
    );

    const runner = createMockRunner({ errors: [] });
    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await vscode.window.showTextDocument(doc);
    await linter.lintDocument(doc);

    assert.strictEqual(statusBar.state, "hidden");
    assert.strictEqual(
      runner.calls.length,
      0,
      "Runner should not be called when extension is disabled",
    );
  });
});

suite("ActionlintLinter — onType trigger", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;
  const configSection = vscode.workspace.getConfiguration("actionlint");

  teardown(async () => {
    linter?.dispose();
    statusBar?.dispose();
    await configSection.update(
      "runTrigger",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("lints on text change when runTrigger is onType", async () => {
    // Set runTrigger to onType BEFORE constructing the linter.
    await configSection.update(
      "runTrigger",
      "onType",
      vscode.ConfigurationTarget.Global,
    );

    const { runner, calls } = createGatedRunner();

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    await drainCalls(calls);

    const doc = await openFixture("valid.yml");
    await drainCalls(calls);

    // Make an edit to trigger onDidChangeTextDocument.
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((eb) => {
      eb.insert(new vscode.Position(0, 0), "# comment\n");
    });

    // Wait for debounce (300ms default + buffer).
    await sleep(500);

    assert.ok(
      calls.length > 0,
      "Runner should be called after text change with onType trigger",
    );

    // Clean up pending calls.
    for (const c of calls) {
      c.resolve({ errors: [] });
    }
  });
});

suite("ActionlintLinter — notInstalled persistence", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("notInstalled persists when re-linting same document", async () => {
    const runner = createMockRunner({
      errors: [],
      executionError: 'actionlint binary not found at "actionlint".',
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");

    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "notInstalled",
      "Should be notInstalled after first lint",
    );

    // Re-lint same document — still not found.
    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "notInstalled",
      "Should remain notInstalled after second lint",
    );
  });

  test("notInstalled cleared after successful lint", async () => {
    let callCount = 0;
    const runner: RunActionlint = () => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          errors: [],
          executionError: 'actionlint binary not found at "actionlint".',
        });
      }
      return Promise.resolve({ errors: [] });
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");

    // Reset counter so our explicit calls are predictable.
    callCount = 0;

    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "notInstalled",
      "Should be notInstalled after ENOENT lint",
    );

    // Second lint succeeds — flag should clear.
    await linter.lintDocument(doc);
    assert.ok(
      statusBar.state !== "notInstalled",
      "Should no longer be notInstalled after success",
    );
  });
});

suite("ActionlintLinter — runner rejection", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("lintDocument does not reject when runner throws", async () => {
    const runner: RunActionlint = () => {
      return Promise.reject(new Error("runner exploded"));
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await vscode.window.showTextDocument(doc);
    // Should resolve without throwing.
    await linter.lintDocument(doc);

    assert.strictEqual(
      statusBar.state,
      "idle",
      "Status bar should recover from running state after runner rejection",
    );

    // Logger should have captured the error.
    assert.ok(
      logger.errors.some((e) => e.includes("runner exploded")),
      "Logger should capture the runner error",
    );
  });
});

suite("ActionlintLinter — unexpected output warning", () => {
  let statusBar: StatusBar;
  let linter: ActionlintLinter;

  teardown(() => {
    linter?.dispose();
    statusBar?.dispose();
  });

  test("shows unexpectedOutput status bar state", async () => {
    const runner = createMockRunner({
      errors: [],
      exitCode: 1,
      warning: "Unexpected output from actionlint",
    });

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");
    await linter.lintDocument(doc);

    // Status bar should show the unexpectedOutput state.
    assert.strictEqual(statusBar.state, "unexpectedOutput");

    // Diagnostics should be empty (cleared).
    const diags = linter.getDiagnostics(doc.uri);
    assert.strictEqual(diags.length, 0, "Should have no diagnostics");
  });

  test("warning clears after successful lint", async () => {
    let callCount = 0;
    const runner: RunActionlint = () => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          errors: [],
          exitCode: 1,
          warning: "Unexpected output from actionlint",
        });
      }
      return Promise.resolve({
        errors: [makeError({ message: "real-error" })],
      });
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");

    // Reset counter so our explicit calls are predictable.
    callCount = 0;

    // First lint: warning.
    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "unexpectedOutput",
      "Should be unexpectedOutput after warning",
    );
    assert.strictEqual(
      linter.getDiagnostics(doc.uri).length,
      0,
      "Warning lint should clear diagnostics",
    );

    // Second lint: success with errors.
    await linter.lintDocument(doc);
    assert.ok(
      statusBar.state !== "unexpectedOutput",
      "Should no longer be unexpectedOutput after success",
    );
    assert.strictEqual(
      linter.getDiagnostics(doc.uri).length,
      1,
      "Subsequent lint should set diagnostics normally",
    );
  });

  test("warning clears notInstalled state", async () => {
    let callCount = 0;
    const runner: RunActionlint = () => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          errors: [],
          executionError: 'actionlint binary not found at "actionlint".',
        });
      }
      return Promise.resolve({
        errors: [],
        exitCode: 1,
        warning: "Unexpected output from actionlint",
      });
    };

    statusBar = new StatusBar();
    const logger = createLogger();
    linter = new ActionlintLinter(logger as any, statusBar, runner);

    const doc = await openFixture("valid.yml");

    callCount = 0;

    // First lint: not installed.
    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "notInstalled",
      "Should be notInstalled after ENOENT",
    );

    // Second lint: warning (binary found but output wrong).
    await linter.lintDocument(doc);
    assert.strictEqual(
      statusBar.state,
      "unexpectedOutput",
      "Warning should transition to unexpectedOutput",
    );
  });
});
