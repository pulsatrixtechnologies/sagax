// #4456: the queue benchmark's count of the server's synchronous file calls
// (server/first-text-latency.e2e.test.ts). Loaded into the server process
// with NODE_OPTIONS=--import; every call of a synchronous fs function is
// written, as its epoch ms and name, to FS_SYNC_CALLS_FILE once a second.
// A synchronous call holds the server's main thread for as long as the
// disk takes: on a network disk, each one is a round trip. With
// FS_SYNC_CALLS_WHERE=1 each row also names the server's own caller (its
// first frame under server/), to find where the calls come from. Test only.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const out = process.env.FS_SYNC_CALLS_FILE;
const where = process.env.FS_SYNC_CALLS_WHERE === "1";
/** The first frame of the server's own code, as file:line (function). */
function callerOf(stack) {
  for (const line of stack.split("\n").slice(2)) {
    const match = /at (?:(\S+) \()?.*\/server\/(.+?):(\d+):\d+\)?$/.exec(line);
    if (match && !match[2].startsWith("testing/")) return `${match[2]}:${match[3]}(${match[1] ?? "anon"})`;
  }
  return "?";
}
if (out) {
  const write = fs.appendFileSync.bind(fs);
  let rows = [];
  const NAMES = ["openSync", "readSync", "readFileSync", "statSync", "lstatSync", "fstatSync", "realpathSync", "readdirSync",
    "existsSync", "accessSync", "writeFileSync", "writeSync", "fsyncSync", "renameSync", "closeSync", "mkdirSync", "rmSync", "unlinkSync", "readlinkSync"];
  for (const name of NAMES) {
    const original = fs[name];
    if (typeof original !== "function") continue;
    const wrapped = function (...args) {
      rows.push(where ? `${Date.now()} ${name} ${callerOf(new Error().stack ?? "")}` : `${Date.now()} ${name}`);
      return original.apply(this, args);
    };
    Object.assign(wrapped, original);
    fs[name] = wrapped;
  }
  syncBuiltinESMExports();
  const flush = () => {
    if (!rows.length) return;
    const text = `${rows.join("\n")}\n`;
    rows = [];
    write(out, text);
  };
  setInterval(flush, 1_000).unref();
  process.on("exit", flush);
}
