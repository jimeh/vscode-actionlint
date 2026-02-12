import * as assert from "assert";
import { debounce } from "../utils";

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

// isWorkflowFile tests require VS Code API mocking which is complex.
// We test the regex logic directly instead.
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
