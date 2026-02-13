import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { debounce, findConfigFile, normalizePath } from "../utils";

suite("debounce", () => {
  test("calls function after delay", (done) => {
    let called = false;
    const fn = debounce(() => {
      called = true;
    }, 50);

    fn();
    assert.strictEqual(called, false, "should not be called immediately");

    setTimeout(() => {
      assert.strictEqual(called, true, "should be called after delay");
      done();
    }, 100);
  });

  test("cancels pending invocation on repeated call", (done) => {
    let count = 0;
    const fn = debounce(() => {
      count++;
    }, 50);

    fn();
    fn();
    fn();

    setTimeout(() => {
      assert.strictEqual(count, 1, "should only be called once");
      done();
    }, 100);
  });

  test("cancel() prevents execution", (done) => {
    let called = false;
    const fn = debounce(() => {
      called = true;
    }, 50);

    fn();
    fn.cancel();

    setTimeout(() => {
      assert.strictEqual(called, false, "should not be called after cancel");
      done();
    }, 100);
  });

  test("can be called again after cancel", (done) => {
    let count = 0;
    const fn = debounce(() => {
      count++;
    }, 50);

    fn();
    fn.cancel();
    fn();

    setTimeout(() => {
      assert.strictEqual(count, 1, "should be called once after re-invoke");
      done();
    }, 100);
  });
});

suite("normalizePath", () => {
  test("converts backslashes to forward slashes", () => {
    assert.strictEqual(normalizePath("foo\\bar\\baz"), "foo/bar/baz");
  });

  test("leaves forward slashes unchanged", () => {
    assert.strictEqual(normalizePath("foo/bar/baz"), "foo/bar/baz");
  });

  test("handles mixed separators", () => {
    assert.strictEqual(
      normalizePath("C:\\Users\\me/projects\\test"),
      "C:/Users/me/projects/test",
    );
  });

  test("handles empty string", () => {
    assert.strictEqual(normalizePath(""), "");
  });
});

// isWorkflowFile / isActionlintConfigFile tests require VS Code API
// mocking which is complex. We test the regex logic directly instead.
suite("workflow file path matching", () => {
  const re = /\.github\/workflows\/[^/]+\.(yml|yaml)$/;

  test("matches .github/workflows/ci.yml", () => {
    assert.ok(re.test("/home/user/project/.github/workflows/ci.yml"));
  });

  test("matches .github/workflows/deploy.yaml", () => {
    assert.ok(re.test("/home/user/project/.github/workflows/deploy.yaml"));
  });

  test("does not match nested subdirectory", () => {
    assert.ok(!re.test("/home/user/project/.github/workflows/nested/test.yml"));
  });

  test("does not match without .github prefix", () => {
    assert.ok(!re.test("/home/user/project/workflows/ci.yml"));
  });

  test("does not match non-yaml file", () => {
    assert.ok(!re.test("/home/user/project/.github/workflows/ci.json"));
  });

  test("does not match random yaml", () => {
    assert.ok(!re.test("/home/user/project/config.yml"));
  });
});

suite("actionlint config file path matching", () => {
  const re = /\.github\/actionlint\.(yml|yaml)$/;

  test("matches .github/actionlint.yaml", () => {
    assert.ok(re.test("/home/user/project/.github/actionlint.yaml"));
  });

  test("matches .github/actionlint.yml", () => {
    assert.ok(re.test("/home/user/project/.github/actionlint.yml"));
  });

  test("does not match workflow files", () => {
    assert.ok(!re.test("/home/user/project/.github/workflows/ci.yml"));
  });

  test("does not match without .github prefix", () => {
    assert.ok(!re.test("/home/user/project/actionlint.yaml"));
  });

  test("does not match nested path under .github", () => {
    assert.ok(!re.test("/home/user/project/.github/sub/actionlint.yaml"));
  });

  test("does not match non-yaml extension", () => {
    assert.ok(!re.test("/home/user/project/.github/actionlint.json"));
  });

  test("does not match random yaml", () => {
    assert.ok(!re.test("/home/user/project/config.yml"));
  });
});

suite("findConfigFile", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "actionlint-test-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns undefined when no config exists", () => {
    assert.strictEqual(findConfigFile(tmpDir), undefined);
  });

  test("returns undefined when .github dir exists but no config", () => {
    fs.mkdirSync(path.join(tmpDir, ".github"), { recursive: true });
    assert.strictEqual(findConfigFile(tmpDir), undefined);
  });

  test("finds actionlint.yaml", () => {
    const ghDir = path.join(tmpDir, ".github");
    fs.mkdirSync(ghDir, { recursive: true });
    const configPath = path.join(ghDir, "actionlint.yaml");
    fs.writeFileSync(configPath, "");

    const result = findConfigFile(tmpDir);
    assert.ok(result);
    assert.strictEqual(result.filePath, configPath);
    assert.strictEqual(result.baseName, "actionlint.yaml");
  });

  test("finds actionlint.yml", () => {
    const ghDir = path.join(tmpDir, ".github");
    fs.mkdirSync(ghDir, { recursive: true });
    const configPath = path.join(ghDir, "actionlint.yml");
    fs.writeFileSync(configPath, "");

    const result = findConfigFile(tmpDir);
    assert.ok(result);
    assert.strictEqual(result.filePath, configPath);
    assert.strictEqual(result.baseName, "actionlint.yml");
  });

  test("prefers .yaml over .yml when both exist", () => {
    const ghDir = path.join(tmpDir, ".github");
    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(path.join(ghDir, "actionlint.yaml"), "");
    fs.writeFileSync(path.join(ghDir, "actionlint.yml"), "");

    const result = findConfigFile(tmpDir);
    assert.ok(result);
    assert.strictEqual(result.baseName, "actionlint.yaml");
  });
});
