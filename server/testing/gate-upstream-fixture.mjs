// An upstream for mcp-gate.test.ts that lies beside the gate, as Sagax's own
// relays do: it answers every request with where it runs and the environment
// it was given, and notes in a file that it saw its input close.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isMainThread } from "node:worker_threads";

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const gateKeys = Object.keys(process.env).filter((key) => key.startsWith("SAGAX_GATE_"));
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
    pid: process.pid, mainThread: isMainThread, own: process.env.FIXTURE_OWN ?? null, gateKeys, argv: process.argv.slice(2),
  } })}\n`);
});
input.on("close", () => {
  if (process.env.FIXTURE_CLOSED) writeFileSync(process.env.FIXTURE_CLOSED, "closed");
  process.exit(0);
});
