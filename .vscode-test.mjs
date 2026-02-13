import * as path from "node:path";
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  tests: [
    {
      files: "out/test/**/*.test.js",
      launchArgs: [path.resolve("src/test/fixtures")],
    },
  ],
  coverage: {
    exclude: ["**/node_modules/**", "**/.pnpm/**", "**/out/test/**"],
    reporter: ["text"],
    lines: 80,
    functions: 80,
    branches: 80,
    statements: 80,
  },
});
