import * as assert from "assert";
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

  test("dispose does not throw", () => {
    // Dispose is called in teardown, but test explicit call.
    statusBar.dispose();
    // Create a new one for teardown to dispose.
    statusBar = new StatusBar();
  });
});
