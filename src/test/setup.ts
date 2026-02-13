// Suppress VS Code's noisy SIGPIPE handler. The extension host's
// bootstrap-fork.js registers a handler that logs "Unexpected SIGPIPE"
// to stderr. SIGPIPE is harmless in the test environment and occurs
// when child processes (e.g., actionlint) exit while pipes are still
// open. Replace with a no-op to prevent the default behavior (process
// termination) while silencing the stderr noise.
process.removeAllListeners("SIGPIPE");
process.on("SIGPIPE", () => {});
