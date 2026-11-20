// @ts-nocheck
/** M-20261120-008 (#5138): the person's own places of one turn on an
 * organization server, and the one copy into them.
 *
 * - copyToPersonPlace: the only way Sagax writes a file into a person's
 *   place: the Sagax attachments folder of their desktop app (stage_file,
 *   in chunks) or /workspace/attachments in their server environment
 *   (exec, base64 chunks). Chat attachments (stagePendingAttachments) and
 *   files a connector returns (server/attachments/connector-files.ts) both
 *   go through it.
 * - placesForTurn: where a connector's file goes for this turn, the
 *   person's computer first when it is mounted, else their server
 *   environment (ownAttachmentRoots: the speaker's, the owner's for a
 *   routine, never another person's).
 * - readFromPersonPlace: attach_file reads a file back from one of those
 *   places to post it in the chat. */
import { basename, posix, win32 } from "node:path";

import { SANDBOX_ATTACHMENTS_DIR } from "../attachments/attachment-staging.ts";
import type { PersonPlace } from "../attachments/connector-files.ts";
import { pullDesktopFile } from "../desktop/desktop-bridge-tools.ts";
import { sensitiveReadPath } from "../safety/sensitive-path.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
export type Host = Record<string, any>;

type Chunk = { data: Buffer; offset: number; final: boolean };
type Target = { kind: "user-sandbox" } | { kind: "user-desktop"; attachmentsDir: string; platform: "darwin" | "win32" | "linux" };

/** One buffer as copy chunks (an empty file is one empty final chunk). */
export async function* bufferChunks(bytes: Buffer, size: number): AsyncGenerator<Chunk> {
  if (bytes.length === 0) { yield { data: bytes, offset: 0, final: true }; return; }
  for (let offset = 0; offset < bytes.length; offset += size) {
    const data = bytes.subarray(offset, Math.min(bytes.length, offset + size));
    yield { data, offset, final: offset + data.length >= bytes.length };
  }
}

/** Linux keeps each environment string under 128 KiB: chunks of 48 KiB (a
 * multiple of 3, so their base64 pieces concatenate), up to 8 per call. */
const ENVIRONMENT_CHUNK = 48 * 1024;
const ENVIRONMENT_GROUP = 8;
const DESKTOP_CHUNK = 512 * 1024;
/** One read of the server environment: its base64 stays under the exec's 1 MiB output. */
const ENVIRONMENT_READ = 512 * 1024;

/** attach_file refuses what the person's places already treat as sensitive
 * (server/safety/sensitive-path.ts sensitiveReadPath): a hidden folder or
 * file, or a credential file name. */
const SENSITIVE_REFUSAL = "files in hidden folders or credential files can't be attached";

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function createPersonPlaces(getHost: () => Host): any {
  /** Write one file into the person's place; answers its path there. */
  async function copyToPersonPlace(input: { person: string; botId: string; threadId: string; generation: string; target: Target; name: string; chunks: (size: number) => AsyncIterable<Chunk> }): Promise<string> {
    const host = getHost();
    const { person, target } = input;
    if (target.kind === "user-sandbox") {
      if (!host.userSandbox) throw new Error("This server has no server environments.");
      const path = `${SANDBOX_ATTACHMENTS_DIR}/${input.name}`;
      const group: Chunk[] = [];
      for await (const chunk of input.chunks(ENVIRONMENT_CHUNK)) {
        group.push(chunk);
        if (group.length < ENVIRONMENT_GROUP && !chunk.final) continue;
        const names = group.map((_, index) => `SAGAX_CONTENT_B64_${index}`);
        const pieces = names.map((name) => `"$${name}"`).join(" ");
        const env: Record<string, string> = { SAGAX_PATH: path };
        group.forEach((piece, index) => { env[names[index]!] = piece.data.toString("base64"); });
        const result = await host.userSandbox.exec(person, {
          argv: ["sh", "-c", group[0]!.offset === 0
            ? `mkdir -p -- "$(dirname -- "$SAGAX_PATH")" && printf %s ${pieces} | base64 -d > "$SAGAX_PATH"`
            : `printf %s ${pieces} | base64 -d >> "$SAGAX_PATH"`],
          env,
          timeoutSec: 30
        }, input.botId);
        if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "copy failed");
        group.length = 0;
      }
      return path;
    }
    const active = () => host.activeInternalGenerationByThread.get(input.threadId) === input.generation;
    const desktop = host.desktopBridges.current(person);
    if (!desktop) throw new Error("The computer is offline.");
    const context = { botId: input.botId, threadId: input.threadId };
    let saved = "";
    for await (const chunk of input.chunks(DESKTOP_CHUNK)) {
      const result = await host.desktopBridges.request(person, {
        action: "stage_file", name: input.name, content: chunk.data.toString("base64"), encoding: "base64", offset: chunk.offset, final: chunk.final
      }, active, undefined, desktop.id, context) as { isError?: boolean; content?: { text?: string }[] } | null;
      if (result?.isError) throw new Error(result.content?.[0]?.text ?? "copy failed");
      const said = result?.content?.[0]?.text;
      if (chunk.final && typeof said === "string" && said.startsWith("saved ")) saved = said.slice("saved ".length).trim();
    }
    return saved || (target.platform === "win32" ? win32 : posix).join(target.attachmentsDir, input.name);
  }

  /** The turn's live workplace for this capability, or null. */
  function workplaceOf(capability: { botId: string; threadId: string; generation: string }) {
    const host = getHost();
    const workplace = host.turnWorkplaces.get(capability.threadId);
    if (!workplace || workplace.generation !== capability.generation || workplace.botId !== capability.botId) return null;
    const person = workplace.decision.principal;
    const bot = host.store.bot(capability.botId);
    if (!person || !bot) return null;
    return { person, roots: host.ownAttachmentRoots(bot, capability.threadId) as Array<{ server: string; path: string; platform: "darwin" | "win32" | "linux" }> };
  }

  /** Where a connector's file goes in this turn, most preferred first. */
  function placesForTurn(capability: { botId: string; threadId: string; generation: string }): PersonPlace[] {
    const host = getHost();
    const turn = workplaceOf(capability);
    if (!turn) return [];
    const places: PersonPlace[] = [];
    const audit = (target: string, name: string, error?: Error) => host.bridgeAudit.record({
      person: turn.person, botId: capability.botId, threadId: capability.threadId, target, kind: "tool", detail: `connector file ${name}`, ok: !error, ...(error ? { error: error.message } : {})
    });
    const place = (kind: PersonPlace["kind"], target: Target): PersonPlace => ({
      kind,
      save: async (name, bytes) => {
        try {
          const path = await copyToPersonPlace({ person: turn.person, botId: capability.botId, threadId: capability.threadId, generation: capability.generation, target, name, chunks: (size) => bufferChunks(bytes, size) });
          audit(target.kind, name);
          return path;
        } catch (error) {
          audit(target.kind, name, error as Error);
          throw error;
        }
      },
    });
    const desktop = turn.roots.find((root) => root.server === host.DESKTOP_BRIDGE_MCP_NAME);
    if (desktop) places.push(place("computer", { kind: "user-desktop", attachmentsDir: desktop.path, platform: desktop.platform }));
    if (turn.roots.some((root) => root.server === USER_SANDBOX_MCP_NAME)) places.push(place("environment", { kind: "user-sandbox" }));
    return places;
  }

  /** One file of the server environment, by its real path under /workspace. */
  async function readFromEnvironment(person: string, botId: string, path: string, maxBytes: (name: string) => number): Promise<{ name: string; bytes: Buffer } | null> {
    const host = getHost();
    if (!host.userSandbox) return null;
    const found = await host.userSandbox.exec(person, {
      argv: ["sh", "-c", 'p=$(realpath -e -- "$SAGAX_PATH" 2>/dev/null) || exit 3; case "$p" in /workspace/*) ;; *) exit 4;; esac; [ -f "$p" ] || exit 3; printf "%s\\n%s" "$(stat -c %s -- "$p")" "$p"'],
      env: { SAGAX_PATH: posix.isAbsolute(path) ? path : posix.join("/workspace", path) },
      timeoutSec: 30
    }, botId);
    if (found.exitCode === 3) return null;
    if (found.exitCode === 4) throw statusError(403, "only files under /workspace in the server environment can be attached");
    if (found.exitCode !== 0) throw new Error(found.stderr.trim() || "the file could not be read");
    const [sizeLine, real] = found.stdout.split("\n");
    if (!real) throw new Error("the file could not be read");
    // a link with an ordinary name that leads to a dotfile or a credential file
    if (sensitiveReadPath(real)) throw statusError(403, SENSITIVE_REFUSAL);
    const size = Number(sizeLine);
    const name = posix.basename(real);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("the file could not be read");
    if (size > maxBytes(name)) throw statusError(413, `file exceeds ${maxBytes(name)} bytes`);
    const parts: Buffer[] = [];
    let total = 0;
    while (total < size) {
      const read = await host.userSandbox.exec(person, {
        argv: ["sh", "-c", 'tail -c +"$SAGAX_FROM" -- "$SAGAX_PATH" | head -c "$SAGAX_COUNT" | base64 -w0'],
        env: { SAGAX_PATH: real, SAGAX_FROM: String(total + 1), SAGAX_COUNT: String(ENVIRONMENT_READ) },
        timeoutSec: 60,
        maxOutputBytes: 1024 * 1024
      }, botId);
      if (read.exitCode !== 0 || read.truncated) throw new Error(read.stderr.trim() || "the file could not be read");
      const data = Buffer.from(read.stdout.trim(), "base64");
      if (!data.length) throw new Error("the file changed while it was read");
      parts.push(data);
      total += data.length;
    }
    if (total !== size) throw new Error("the file changed while it was read");
    return { name, bytes: Buffer.concat(parts, total) };
  }

  /** One file of the person's computer, through their desktop app. */
  async function readFromComputer(person: string, capability: { botId: string; threadId: string; generation: string }, platform: string, path: string, maxBytes: (name: string) => number): Promise<{ name: string; bytes: Buffer } | null> {
    const host = getHost();
    const desktop = host.desktopBridges.current(person);
    if (!desktop) return null;
    const name = (platform === "win32" ? win32 : posix).basename(path);
    const active = () => host.activeInternalGenerationByThread.get(capability.threadId) === capability.generation;
    const context = { botId: capability.botId, threadId: capability.threadId };
    const request = (operation: unknown) => host.desktopBridges.request(person, operation, active, undefined, desktop.id, context);
    try {
      return { name, bytes: await pullDesktopFile(request, path, maxBytes(name)) };
    } catch (error) {
      if ((error as { status?: number }).status === 413) throw error;
      // not there (ENOENT and the like): the next place, else not found
      if (/ENOENT|no such file|not a file|cannot find/i.test((error as Error).message)) return null;
      throw error;
    }
  }

  /** A file of the person's place for attach_file: a /workspace path in
   * their server environment, else on their computer. Null when neither
   * has it. */
  async function readFromPersonPlace(capability: { botId: string; threadId: string; generation: string }, path: string, maxBytes: (name: string) => number): Promise<{ name: string; bytes: Buffer } | null> {
    const host = getHost();
    const turn = workplaceOf(capability);
    const requested = path.trim().replace(/^file:\/\//i, "");
    if (!turn || !requested) return null;
    if (sensitiveReadPath(requested)) throw statusError(403, SENSITIVE_REFUSAL);
    const desktop = turn.roots.find((root) => root.server === host.DESKTOP_BRIDGE_MCP_NAME);
    const environment = turn.roots.some((root) => root.server === USER_SANDBOX_MCP_NAME);
    // Only /workspace is read in the server environment (and a relative
    // path, which starts there): any other path never wakes it up.
    const inEnvironment = /^\/workspace(\/|$)/.test(requested) || !(posix.isAbsolute(requested) || win32.isAbsolute(requested) || requested.includes("\\"));
    const readers: Array<() => Promise<{ name: string; bytes: Buffer } | null>> = [];
    if (environment && inEnvironment) readers.push(() => readFromEnvironment(turn.person, capability.botId, requested, maxBytes));
    if (desktop) readers.push(() => readFromComputer(turn.person, capability, desktop.platform, requested, maxBytes));
    for (const read of readers) {
      const file = await read();
      if (file) return { ...file, name: file.name || basename(requested) };
    }
    return null;
  }

  return { copyToPersonPlace, placesForTurn, readFromPersonPlace };
}
