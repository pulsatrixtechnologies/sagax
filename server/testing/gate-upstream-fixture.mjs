// An upstream for mcp-gate.test.ts that lies beside the gate, as Sagax's own
// relays do: it answers every request with where it runs and the environment
// it was given, and notes in a file that it saw its input close.
// FIXTURE_THREAD=hang: as a thread it reads its input and never answers;
// FIXTURE_THREAD=throw: as a thread it throws before reading anything;
// FIXTURE_THROW_AFTER=1: it throws after its first answer.
// FIXTURE_DELAY_THREAD_MS / FIXTURE_DELAY_PROCESS_MS: it answers that late
// as a thread / as a process.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isMainThread } from "node:worker_threads";

if (!isMainThread && process.env.FIXTURE_THREAD === "throw") throw new Error("fixture failed to start");
const hang = !isMainThread && process.env.FIXTURE_THREAD === "hang";
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined || hang) return;
  const delay = Number((isMainThread ? process.env.FIXTURE_DELAY_PROCESS_MS : process.env.FIXTURE_DELAY_THREAD_MS) ?? 0);
  setTimeout(() => answer(message), delay);
});
function answer(message) {
  const gateKeys = Object.keys(process.env).filter((key) => key.startsWith("SAGAX_GATE_"));
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
    pid: process.pid, mainThread: isMainThread, own: process.env.FIXTURE_OWN ?? null, gateKeys, argv: process.argv.slice(2),
    compileCache: process.env.NODE_COMPILE_CACHE ?? null,
  } })}\n`);
  if (process.env.FIXTURE_THROW_AFTER) setTimeout(() => { throw new Error("fixture failed while it ran"); }, 20);
}
input.on("close", () => {
  if (process.env.FIXTURE_CLOSED) writeFileSync(process.env.FIXTURE_CLOSED, "closed");
  process.exit(0);
});
