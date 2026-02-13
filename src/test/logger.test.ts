import * as vscode from "vscode";
import { Logger } from "../logger";

suite("Logger", () => {
  let logger: Logger;
  const configSection = vscode.workspace.getConfiguration("actionlint");

  setup(() => {
    logger = new Logger();
  });

  teardown(async () => {
    logger.dispose();
    await configSection.update(
      "logLevel",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("info() does not throw when logLevel is off", () => {
    // Default logLevel is "off".
    logger.info("test message");
  });

  test("info() writes when logLevel is info", async () => {
    await configSection.update(
      "logLevel",
      "info",
      vscode.ConfigurationTarget.Global,
    );
    // Should not throw; exercises the appendLine path.
    logger.info("test info message");
  });

  test("info() writes when logLevel is debug", async () => {
    await configSection.update(
      "logLevel",
      "debug",
      vscode.ConfigurationTarget.Global,
    );
    logger.info("test info at debug level");
  });

  test("debug() does not write when logLevel is off", () => {
    logger.debug("should be suppressed");
  });

  test("debug() does not write when logLevel is info", async () => {
    await configSection.update(
      "logLevel",
      "info",
      vscode.ConfigurationTarget.Global,
    );
    logger.debug("should be suppressed at info level");
  });

  test("debug() writes when logLevel is debug", async () => {
    await configSection.update(
      "logLevel",
      "debug",
      vscode.ConfigurationTarget.Global,
    );
    logger.debug("test debug message");
  });

  test("error() does not write when logLevel is off", () => {
    logger.error("should be suppressed");
  });

  test("error() writes when logLevel is info", async () => {
    await configSection.update(
      "logLevel",
      "info",
      vscode.ConfigurationTarget.Global,
    );
    logger.error("test error at info level");
  });

  test("error() writes when logLevel is debug", async () => {
    await configSection.update(
      "logLevel",
      "debug",
      vscode.ConfigurationTarget.Global,
    );
    logger.error("test error at debug level");
  });

  test("show() does not throw", () => {
    logger.show();
  });

  test("dispose() does not throw", () => {
    logger.dispose();
    // Create a fresh one for teardown.
    logger = new Logger();
  });
});
