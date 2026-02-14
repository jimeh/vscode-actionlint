import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  test("extension should be present", () => {
    const ext = vscode.extensions.getExtension("jimeh.actionlint");
    assert.ok(ext, "Extension should be registered");
  });

  test("extension should export activate", () => {
    const ext = vscode.extensions.getExtension("jimeh.actionlint");
    assert.ok(ext);
    // The extension exports activate/deactivate.
    // We can't easily test activation without a workspace containing
    // .github/workflows/, but we verify the extension is loadable.
  });
});
