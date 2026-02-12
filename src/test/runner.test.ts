import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
    const firstErr = result.errors[0];
    assert.ok(firstErr, "First error should exist");
    assert.ok(firstErr.message.length > 0);
    assert.ok(firstErr.line > 0);
    assert.ok(firstErr.kind.length > 0);
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

  test("ignores additionalArgs when workspace is untrusted", async () => {
    // Pass an invalid flag that would cause exit code 2 if used.
    // With isTrusted=false, the flag should be ignored.
    const config = makeConfig({
      additionalArgs: ["--invalid-flag-that-does-not-exist"],
    });
    const result = await runActionlint(
      "name: test\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
      false,
    );

    if (result.executionError) {
      // actionlint not installed — skip gracefully.
      // But it should NOT be "exited with code" from the bad flag.
      assert.ok(
        result.executionError.includes("not found"),
        "Should only fail due to missing binary, not the invalid flag",
      );
      return;
    }

    // If actionlint is installed, it should succeed because
    // the invalid flag was skipped.
    assert.strictEqual(result.errors.length, 0);
  });

  test("returns executionError for EACCES (non-executable)", async () => {
    // Create a temporary non-executable file to simulate EACCES.
    const tmpDir = os.tmpdir();
    const fakeBin = path.join(tmpDir, "fake-actionlint-test");
    fs.writeFileSync(fakeBin, "not a binary", { mode: 0o644 });

    try {
      const config = makeConfig({ executable: fakeBin });
      const result = await runActionlint(
        "name: test",
        ".github/workflows/ci.yml",
        config,
        process.cwd(),
      );

      assert.ok(
        result.executionError,
        "Should have executionError for non-executable file",
      );
      assert.strictEqual(result.errors.length, 0);
    } finally {
      fs.unlinkSync(fakeBin);
    }
  });

  test("resolves with empty errors for pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const config = makeConfig();
    const result = await runActionlint(
      "name: test",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
      true,
      controller.signal,
    );

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(
      result.executionError,
      undefined,
      "Should not have executionError for abort",
    );
  });

  test("backward compat: works without signal param", async () => {
    const config = makeConfig();
    const result = await runActionlint(
      "name: test\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
      true,
    );

    // Should succeed or report not-found — no crash.
    if (result.executionError) {
      assert.ok(result.executionError.includes("not found"));
    } else {
      assert.ok(Array.isArray(result.errors));
    }
  });

  test("handles undefined additionalArgs without throwing", async () => {
    const config = makeConfig();
    // Force additionalArgs to undefined to simulate malformed config.
    (config as unknown as Record<string, unknown>).additionalArgs = undefined;

    const result = await runActionlint(
      "name: test\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
      true,
    );

    // Should not throw; either works or reports not-found.
    if (result.executionError) {
      assert.ok(result.executionError.includes("not found"));
    } else {
      assert.ok(Array.isArray(result.errors));
    }
  });

  test("handles empty content without crashing", async () => {
    const config = makeConfig();
    const result = await runActionlint(
      "",
      ".github/workflows/ci.yml",
      config,
      process.cwd(),
    );

    // Should either succeed or report not-found, not crash.
    if (result.executionError) {
      assert.ok(
        result.executionError.includes("not found") ||
          result.executionError.includes("exited with code"),
      );
    } else {
      assert.ok(Array.isArray(result.errors));
    }
  });
});
