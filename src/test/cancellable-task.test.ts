import * as assert from "assert";
import { CancellableTask } from "../cancellable-task";

/** Wait for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("CancellableTask", () => {
  test("normal run returns result", async () => {
    const task = new CancellableTask();
    const result = await task.run(async () => 42);
    assert.strictEqual(result, 42);
  });

  test("new run aborts previous signal and previous returns undefined", async () => {
    const task = new CancellableTask();
    const signals: AbortSignal[] = [];

    const p1 = task.run(async (signal) => {
      signals.push(signal);
      await sleep(50);
      return "first";
    });

    // Let p1 start executing.
    await sleep(5);

    const p2 = task.run(async (signal) => {
      signals.push(signal);
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    assert.strictEqual(r1, undefined, "First run should return undefined");
    assert.strictEqual(r2, "second", "Second run should return its result");
    assert.strictEqual(signals.length, 2);
    assert.ok(signals[0]?.aborted, "First signal should be aborted");
    assert.ok(!signals[1]?.aborted, "Second signal should NOT be aborted");
  });

  test("cancel() aborts signal and in-flight returns undefined", async () => {
    const task = new CancellableTask();
    let signal: AbortSignal | undefined;

    const p = task.run(async (s) => {
      signal = s;
      await sleep(50);
      return "value";
    });

    // Let it start.
    await sleep(5);
    task.cancel();

    const result = await p;
    assert.strictEqual(
      result,
      undefined,
      "Cancelled run should return undefined",
    );
    assert.ok(signal?.aborted, "Signal should be aborted after cancel");
  });

  test("three rapid runs — only latest returns result", async () => {
    const task = new CancellableTask();

    const p1 = task.run(async () => {
      await sleep(30);
      return "first";
    });

    await sleep(5);
    const p2 = task.run(async () => {
      await sleep(30);
      return "second";
    });

    await sleep(5);
    const p3 = task.run(async () => {
      await sleep(10);
      return "third";
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.strictEqual(r1, undefined, "First should be stale");
    assert.strictEqual(r2, undefined, "Second should be stale");
    assert.strictEqual(r3, "third", "Third (latest) should return result");
  });

  test("signal passed to fn is an AbortSignal", async () => {
    const task = new CancellableTask();

    await task.run(async (signal) => {
      assert.ok(signal instanceof AbortSignal, "Should receive an AbortSignal");
    });
  });

  test("cancel() with nothing in-flight is a no-op", () => {
    const task = new CancellableTask();
    // Should not throw.
    task.cancel();
  });

  test("run after cancel works normally", async () => {
    const task = new CancellableTask();

    // Start and cancel.
    const p1 = task.run(async () => {
      await sleep(50);
      return "cancelled";
    });
    await sleep(5);
    task.cancel();
    const r1 = await p1;
    assert.strictEqual(r1, undefined);

    // New run should work fine.
    const r2 = await task.run(async () => "after-cancel");
    assert.strictEqual(r2, "after-cancel");
  });
});
