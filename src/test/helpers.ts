import * as assert from "assert";
import type { ActionlintError } from "../types";

/** Assert array element exists and return it. */
export function at<T>(arr: readonly T[], index: number): T {
  const val = arr[index];
  assert.ok(val !== undefined, `Expected element at index ${index}`);
  return val;
}

/** Wait for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until a condition is met or a timeout is reached.
 * Throws if the condition is not met within the timeout.
 */
export async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      assert.fail(`waitFor timed out: ${message}`);
    }
    await sleep(intervalMs);
  }
}

/** Create an ActionlintError with optional overrides. */
export function makeError(
  overrides: Partial<ActionlintError> = {},
): ActionlintError {
  return {
    message: "test error",
    filepath: ".github/workflows/ci.yml",
    line: 5,
    column: 3,
    end_column: 10,
    kind: "syntax-check",
    snippet: "  |  foo: bar\n  |  ^~~~",
    ...overrides,
  };
}

/** Minimal Logger stub that satisfies the Logger interface. */
export function createLogger() {
  const errors: string[] = [];
  return {
    errors,
    info(_msg: string) {},
    debug(_msg: string) {},
    error(msg: string) {
      errors.push(msg);
    },
    show() {},
    dispose() {},
  };
}
