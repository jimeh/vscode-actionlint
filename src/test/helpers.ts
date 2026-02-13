import * as assert from "assert";
import type { ActionlintError } from "../types";

/** Assert array element exists and return it. */
export function at<T>(arr: T[], index: number): T {
  const val = arr[index];
  assert.ok(val !== undefined, `Expected element at index ${index}`);
  return val;
}

/** Wait for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return {
    info(_msg: string) {},
    debug(_msg: string) {},
    error(_msg: string) {},
    show() {},
    dispose() {},
  };
}
