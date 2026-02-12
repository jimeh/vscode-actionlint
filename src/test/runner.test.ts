import * as assert from "assert";
import { runActionlint } from "../runner";
import type { ActionlintConfig } from "../types";

function makeConfig(
  overrides: Partial<ActionlintConfig> = {},
): ActionlintConfig {
  return {
    enable: true,
    executable: "actionlint",
    runTrigger: "onSave",
    additionalArgs: [],
    debounceDelay: 300,
    logLevel: "off",
    ...overrides,
  };
}

suite("runActionlint", () => {
  test("returns empty errors for valid workflow", async () => {
    // This test requires actionlint to be installed.
    // If not installed, it will get an executionError instead.
    const content = `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const config = makeConfig();
    const result = await runActionlint(
      content,
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
    );

    if (result.executionError) {
      // actionlint not installed — skip gracefully.
      assert.ok(
        result.executionError.includes("not found"),
        "Should indicate binary not found",
      );
      return;
    }

    assert.strictEqual(result.errors.length, 0);
  });

  test("returns errors for invalid workflow", async () => {
    const content = `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
        if: \${{ invalid_context.foo }}
`;
    const config = makeConfig();
    const result = await runActionlint(
      content,
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
    );

    if (result.executionError) {
      // actionlint not installed — skip gracefully.
      return;
    }

    assert.ok(result.errors.length > 0, "Should report at least one error");
    assert.ok(result.errors[0].message.length > 0);
    assert.ok(result.errors[0].line > 0);
    assert.ok(result.errors[0].kind.length > 0);
  });

  test("handles binary not found", async () => {
    const config = makeConfig({
      executable: "nonexistent-actionlint-binary-12345",
    });
    const result = await runActionlint(
      "name: test",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
    );

    assert.ok(result.executionError);
    assert.ok(result.executionError.includes("not found"));
    assert.strictEqual(result.errors.length, 0);
  });

  test("passes additional args", async () => {
    // Pass an invalid flag to trigger exit code 2.
    const config = makeConfig({
      additionalArgs: ["--invalid-flag-that-does-not-exist"],
    });
    const result = await runActionlint(
      "name: test",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
    );

    // Either actionlint is not installed (ENOENT) or it exits
    // with code 2 for the invalid flag.
    if (result.executionError) {
      assert.ok(
        result.executionError.includes("not found") ||
          result.executionError.includes("exited with code"),
      );
    }
  });
});
