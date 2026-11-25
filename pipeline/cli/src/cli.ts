#!/usr/bin/env bun
// skill-sync-eval — runs the eval gate in a repo that adopted pipeline/template.
// Thin wrapper over evals/scripts/gate.sh; same flags, same exit codes.

const proc = Bun.spawn(["bash", "evals/scripts/gate.sh", ...Bun.argv.slice(2)], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
process.exit(await proc.exited);
