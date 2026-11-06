// The channels the bot panel's Coding branches reach the bot's computers
// through (server/routes/bot-code-branches.ts), each one the channel the
// bot's own commands use there, turned into a RemoteExec
// (remote-code-branches.ts): one shell command in, its exit code, output and
// errors out, or `{ error }` when the computer cannot be reached.
//
// - The person's cloud computer (their server environment): one exec in
//   their own sandbox (`bash -lc`), which answers in fields. Variables reach
//   it as `SAGAX_*` only (the person's GitHub token for a push, never argv).
// - Their own computer and its Local VM, through their desktop app, and a
//   solo server's Local VM: these answer in text (the desktop: stdout
//   trimmed, then `[stderr]`, then `[exit N]`), which would lose a porcelain
//   line's leading space. The command is framed: its output and errors go to
//   private temp files, then come back base64 on one marker line with the
//   exit code. No variable is ever sent: a token never reaches a computer
//   through these channels.
// - A computer reached through a remote session (a client's): its own
//   fields, no variable either.
//
// The desktop runs a command with the person's login shell (`$SHELL -lc`)
// and a remote session with the remote login shell, which may be fish or
// csh: their command goes inside `/bin/sh -c '...'` (viaPosixShell), so only
// sh reads it, and one that cannot go there is never sent.
//
// Light on the person's computers (2026-11-03, review): the panel reads
// every row of the Coding list at once, and the person's bots need the
// same computers. The person's cloud computer runs at most four commands of
// theirs at a time (sandboxd-core.ts, shared by all their bots) and the
// desktop app one job at a time (it keeps eight): the panel sends each of
// them one command at a time per person, so it never holds more than one
// slot. Each refusal says what it is: a full computer reads busy (never
// stopped), and a desktop command that ran out of time while that desktop
// stayed connected (a long job of its own ahead of it) reads busy too, and
// the panel's next commands to it answer busy at once while it still works
// instead of each waiting the bridge's whole timeout. A command longer than
// a channel carries (each computer's own limit, below, in bytes where Linux
// caps one argument) is refused before it is sent (`tooLong`; each channel
// says what it carries: `fits`), and a remote session's own cut mark is read
// as a cut.
import type { RemoteBranchDeps, RemoteBranchReach } from "../routes/bot-code-branches.ts";
import { EXEC_ENV_KEY_RE, type SandboxExecInput, type SandboxExecOutput } from "../sandbox/sandboxd-core.ts";
import type { RemoteExec, RemoteGitResult } from "./remote-code-branches.ts";
import { reportBackgroundError } from "../background-error.ts";

const SECOND = 1000;
const DEFAULT_TIMEOUT_MS = 60 * SECOND;
const seconds = (timeoutMs: number | undefined) => Math.min(600, Math.max(1, Math.ceil((timeoutMs ?? DEFAULT_TIMEOUT_MS) / SECOND)));

/** The longest command line each channel carries, in characters: the
 * desktop app's (electron/desktop-bridge.mjs validBridgeOperation), a solo
 * server's Local VM (containerExec) and a remote session
 * (remote-sessions.ts exec, after trimming). */
export const DESKTOP_MAX_COMMAND = 100_000;
export const HOST_VM_MAX_COMMAND = 20_000;
export const REMOTE_SESSION_MAX_COMMAND = 8000;
/** Linux caps one argument at 131,072 bytes (MAX_ARG_STRLEN), and a shell
 * gets the command as one (`bash -lc` on the cloud computer, through Docker
 * or Kubernetes, `$SHELL -lc` on a Linux desktop, `bash -lc` in the
 * desktop's Local VM): measured in UTF-8 bytes there (a character of a
 * Chinese file name is three), room left for the arguments around it (the
 * bot's folder). */
export const ARGUMENT_MAX_BYTES = 120_000;

const TOO_LONG = "That command is too long for that computer's connection, so it was not sent.";
const tooLong = () => ({ error: TOO_LONG, tooLong: true as const });

/** A refusal for a computer that is there but full: sandboxd's 429 "busy"
 * (UserSandboxUnavailable or SandboxdRequestError), the desktop app's full
 * queue (DesktopBridges.request), a desktop a job of its own holds
 * (branchRemoteDeps). By its code only: another 429 is not this. */
function refusedAsBusy(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "busy";
}

/** The cloud computer: `run` is one exec in the person's own sandbox (in
 * the bot's folder there, as its run_command). Full (the person's bots run
 * four commands there): busy, not stopped. */
export function sandboxBranchExec(run: (input: SandboxExecInput) => Promise<SandboxExecOutput>): RemoteExec {
  const fits = (command: string) => Buffer.byteLength(command, "utf8") <= ARGUMENT_MAX_BYTES;
  const exec: RemoteExec = async (command, timeoutMs, env) => {
    if (!fits(command)) return tooLong();
    const variables = Object.fromEntries(Object.entries(env ?? {}).filter(([key, value]) => EXEC_ENV_KEY_RE.test(key) && typeof value === "string"));
    try {
      const out = await run({
        argv: ["bash", "-lc", command],
        timeoutSec: seconds(timeoutMs),
        maxOutputBytes: 1024 * 1024,
        ...(Object.keys(variables).length ? { env: variables } : {}),
      });
      return {
        exitCode: out.exitCode ?? (out.timedOut ? 124 : 1),
        stdout: out.stdout,
        stderr: out.stderr,
        ...(out.timedOut ? { timedOut: true } : {}),
        ...(out.truncated ? { truncated: true } : {}),
      };
    } catch (error) {
      if (refusedAsBusy(error)) return { error: "The cloud computer is busy with other commands.", busy: true };
      return { error: "The cloud computer could not be reached." };
    }
  };
  exec.fits = fits;
  return exec;
}

/** What a login shell other than sh would read in a single-quoted word:
 * fish a backslash, csh a `!` (history, even in quotes) and a line break. */
const NOT_FOR_LOGIN_SHELLS = /[\\!\n\r]/;

/** `script` run by /bin/sh whatever login shell receives the command line
 * (bash, zsh, fish, csh, ...): one single-quoted argument, a quote written
 * '"'"'. A script that holds a character some login shell would read in
 * quotes is refused (thrown, so nothing is sent: fish or csh could run part
 * of it). remote-code-branches.ts writes none (q()). */
export function viaPosixShell(script: string): string {
  if (NOT_FOR_LOGIN_SHELLS.test(script)) throw new Error("A command for a login shell holds a backslash, a ! or a line break, so it was not sent.");
  return `/bin/sh -c '${script.replace(/'/g, `'"'"'`)}'`;
}

const MARKER = "SAGAX-EXEC1";
const END = "SAGAX-END";

/** How much of a framed command's output and errors come back. */
export interface FrameCaps {
  /** Output bytes. */
  output: number;
  /** Error bytes. */
  errors: number;
}

/** `command` framed for a channel that answers in text: run in a subshell
 * with its output and errors in private temp files, then one line with the
 * exit code, the output's full size, the output (its first `caps.output`
 * bytes) and the errors (their first `caps.errors`), both base64. POSIX sh,
 * one line with no backslash and no `!` (viaPosixShell can wrap it). */
export function framedCommand(command: string, caps: FrameCaps): string {
  const output = Math.max(1024, Math.floor(caps.output));
  const errors = Math.max(256, Math.floor(caps.errors));
  return [
    "o=$(mktemp 2>/dev/null) && e=$(mktemp 2>/dev/null) || exit 98",
    `( ${command} ) >"$o" 2>"$e"`,
    "c=$?",
    "echo",
    `printf '${MARKER} %s %s ' "$c" "$(wc -c <"$o" | tr -d '[:space:]')"`,
    `head -c ${output} "$o" | base64 | tr -d '[:space:]'`,
    "printf ' '",
    `head -c ${errors} "$e" | base64 | tr -d '[:space:]'`,
    `printf ' ${END}'`,
    "echo",
    "rm -f \"$o\" \"$e\"",
  ].join("; ");
}

const FRAME = new RegExp(`${MARKER} (\\d+) (\\d+) ([A-Za-z0-9+/=]*) ([A-Za-z0-9+/=]*) ${END}`, "g");

/** A framed command's answer, from the channel's text, or null when the
 * marker line is not there (nothing ran, or the channel cut it). */
export function parseFramed(text: string, caps: FrameCaps): RemoteGitResult | null {
  const match = [...text.matchAll(FRAME)].at(-1);
  if (!match) return null;
  const size = Number(match[2]);
  return {
    exitCode: Number(match[1]),
    stdout: Buffer.from(match[3]!, "base64").toString("utf8"),
    stderr: Buffer.from(match[4]!, "base64").toString("utf8"),
    ...(size > Math.max(1024, Math.floor(caps.output)) ? { truncated: true } : {}),
  };
}

/** The text of an MCP tool result (the desktop bridge's answer). */
function resultText(value: unknown): { text: string; isError: boolean } {
  const result = value as { content?: unknown; isError?: unknown } | null;
  const content = Array.isArray(result?.content) ? result!.content as Array<{ type?: unknown; text?: unknown }> : [];
  return {
    text: content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text as string).join("\n"),
    isError: result?.isError === true,
  };
}

/** A channel that runs one command line and answers in text (the desktop
 * bridge's run_command or vm_run_command, a solo Local VM). `caps` bound the
 * output so the framed answer fits what the channel carries; `wrap` puts
 * the framed script in /bin/sh for a channel that runs a login shell;
 * `maxCommand`: the longest line it carries in characters, `maxBytes` in
 * UTF-8 bytes (a longer one is not sent). Variables are never sent. */
export function framedBranchExec(run: (command: string, timeoutSeconds: number) => Promise<unknown>, caps: FrameCaps, offline: string, options: { wrap?: boolean; maxCommand?: number; maxBytes?: number } = {}): RemoteExec {
  const lineFor = (command: string) => {
    const framed = framedCommand(command, caps);
    return options.wrap ? viaPosixShell(framed) : framed;
  };
  const carried = (line: string) => (options.maxCommand === undefined || line.length <= options.maxCommand) && (options.maxBytes === undefined || Buffer.byteLength(line, "utf8") <= options.maxBytes);
  const exec: RemoteExec = async (command, timeoutMs) => {
    const line = lineFor(command);
    if (!carried(line)) return tooLong();
    let answer: unknown;
    try {
      answer = await run(line, seconds(timeoutMs));
    } catch (error) {
      // there, but busy: the desktop app's queue is full (DesktopBridges.request),
      // or a job of its own held it past the timeout (branchRemoteDeps)
      if (refusedAsBusy(error)) return { error: "That computer is busy with other work.", busy: true };
      return { error: offline };
    }
    const { text } = resultText(answer);
    // no marker: nothing ran there (the VM is stopped, the app refused it)
    return parseFramed(text, caps) ?? { error: offline };
  };
  exec.fits = (command) => carried(lineFor(command));
  return exec;
}

/** One task at a time per key, in the order asked (a failed one does not
 * stop the next). */
export function serialLanes(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); }).catch(reportBackgroundError);
    return run;
  };
}

/** What the bot panel's branches may reach, as server/index.ts holds it. */
export interface BranchChannels {
  /** An organization server (Perspicax): only a person's own computers. */
  organization: boolean;
  /** The person's cloud computer (their server environment). */
  sandbox?: {
    /** Its state, never starting it ("running" when it runs). */
    status(principalId: string, botId: string): Promise<{ state: string }>;
    /** One exec there, in the bot's folder. */
    exec(principalId: string, input: SandboxExecInput, botId: string): Promise<SandboxExecOutput>;
  };
  /** The person's own computer and its Local VM, through their desktop app. */
  desktop?: {
    /** The desktop their bots use now (their most recently connected one,
     * as the bot's own desktop calls pick it), if any. */
    current(principalId: string): { id: string; name: string; platform: string; capabilities: { shell: boolean; localVm: boolean } } | null;
    /** One operation on their desktop: `desktopId`, that one or nothing. */
    request(principalId: string, operation: { action: "run_command" | "vm_run_command"; command: string; timeout_seconds: number; container?: string }, desktopId?: string): Promise<unknown>;
    /** That desktop of theirs now: connected, and running a job (a bot's or
     * the panel's); null when they have no such desktop. Absent: only
     * current() tells whether it is connected. */
    state?(principalId: string, desktopId: string): { online: boolean; busy: boolean } | null;
  };
  /** A solo server's Local VM (a container on this machine). */
  hostVm?: {
    running(botId: string, threadId: string): Promise<boolean>;
    exec(botId: string, threadId: string, command: string, timeoutSeconds: number): Promise<{ stdout: string }>;
  };
  /** This bot's remote sessions (a client's computer). */
  remoteSessions?: {
    principalFor(botId: string, threadId: string): string;
    reachFor(input: { principalId: string; botId: string; threadId: string }): { host?: string; os?: string; known: boolean } | null;
    list(principalId: string, botId: string): Array<{ hostname?: string; os?: string; osKnown?: boolean }>;
    exec(input: { principalId: string; botId: string; threadId: string; command: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean } | { error: string }>;
  };
}

/** How much of a command's output and errors each text channel carries
 * back framed (base64 grows both by a third, the frame adds a few dozen
 * characters): the desktop app keeps 512 KiB of a command's output, its
 * Local VM 256 KiB, a solo Local VM 20,000 characters (clipExecOutput,
 * which cuts the middle out of a longer answer, marker line included:
 * 11 KiB and 2,000 bytes frame to about 17,750 characters, room left for a
 * login profile's own lines). */
export const DESKTOP_CAPS: FrameCaps = { output: 360 * 1024, errors: 8000 };
export const DESKTOP_VM_CAPS: FrameCaps = { output: 180 * 1024, errors: 4000 };
export const HOST_VM_CAPS: FrameCaps = { output: 11 * 1024, errors: 2000 };

const person = (viewerId: string | undefined) => viewerId?.trim().toLowerCase() || undefined;

/** A remote session's own mark after a stream it cut (remote-sessions.ts
 * capped(): `\n[cut at 64 KB]`): the text without it, and whether it was
 * there. */
function sessionText(text: string): { text: string; cut: boolean } {
  const mark = /\n\[cut at \d+ KB\]$/.exec(text);
  return mark ? { text: text.slice(0, mark.index), cut: true } : { text, cut: false };
}

/** How long, after a panel command to a desktop ran out of time while that
 * desktop stayed connected, the next ones answer busy at once while it still
 * works (then one is sent again). */
const STALL_MS = 60 * SECOND;

/** The busy refusal of a desktop that did not get to the panel's command. */
const desktopBusy = () => Object.assign(new Error("That computer is busy with other work."), { code: "busy" });

/** The route's reach and exec for each computer a branch can be on. Only
 * the viewer's own cloud computer and own desktop are ever reached (never
 * the bot owner's, never anyone else's): a branch the bot made in another
 * person's environment is simply not found there. */
export function branchRemoteDeps(channels: BranchChannels): RemoteBranchDeps {
  // one panel command at a time per person, on their cloud computer and on
  // their desktop app (its Local VM goes through that same app)
  const inLane = serialLanes();
  /** `person\ndesktop` -> until when that desktop counts as held by a job of
   * its own (a panel command ran out of time there while it stayed
   * connected). */
  const stalled = new Map<string, number>();
  return {
    reach: async (botId, threadId, viewerId, place): Promise<RemoteBranchReach | null> => {
      const who = person(viewerId);
      switch (place.computer) {
        case "sandbox": {
          if (!channels.sandbox || !who) return null;
          const view = await channels.sandbox.status(who, botId).catch(() => null);
          return { computer: true, online: view?.state === "running", osKnown: true };
        }
        case "desktop": {
          if (!channels.desktop || !who) return null;
          const desktop = channels.desktop.current(who);
          if (!desktop) return { computer: true, online: false, osKnown: true };
          return { computer: true, online: desktop.capabilities.shell, host: desktop.name, osKnown: true, ...(desktop.platform === "win32" ? { windows: true } : {}) };
        }
        case "local_vm": {
          if (place.vm === "host") {
            // a solo server's own container; an organization server's host is no one's computer
            if (channels.organization || !channels.hostVm) return null;
            return { computer: true, online: await channels.hostVm.running(botId, threadId).catch(() => false), osKnown: true };
          }
          if (!channels.desktop || !who) return null;
          const desktop = channels.desktop.current(who);
          return { computer: true, online: Boolean(desktop?.capabilities.localVm), osKnown: true };
        }
        case "remote_session": {
          const sessions = channels.remoteSessions;
          const principal = who ?? (channels.organization ? undefined : sessions?.principalFor(botId, threadId));
          if (!sessions || !principal) return null;
          const here = sessions.reachFor({ principalId: principal, botId, threadId });
          if (here) return { computer: true, online: true, ...(here.host ? { host: here.host } : {}), osKnown: here.known, ...(here.os === "windows" ? { windows: true } : {}) };
          // A session of this bot's in another conversation still means the
          // bot has a computer (reachFor only looks at this conversation's).
          const session = sessions.list(principal, botId)[0];
          if (!session) return null;
          return { computer: true, online: true, ...(session.hostname ? { host: session.hostname } : {}), osKnown: session.osKnown !== false, ...(session.os === "windows" ? { windows: true } : {}) };
        }
        default:
          return null;
      }
    },
    exec: (botId, threadId, viewerId, place): RemoteExec => {
      const who = person(viewerId);
      const unreachable: RemoteExec = async () => ({ error: "That computer cannot be reached." });
      switch (place.computer) {
        case "sandbox": {
          const sandbox = channels.sandbox;
          if (!sandbox || !who) return unreachable;
          // one of the person's four command slots there at most: their bots keep the rest
          return sandboxBranchExec((input) => inLane(`sandbox\n${who}`, () => sandbox.exec(who, input, botId)));
        }
        case "desktop":
        case "local_vm": {
          if (place.computer === "local_vm" && place.vm === "host") {
            return !channels.organization && channels.hostVm
              ? framedBranchExec(async (command, timeout) => ({ content: [{ type: "text", text: (await channels.hostVm!.exec(botId, threadId, command, timeout)).stdout }] }), HOST_VM_CAPS, "The Local VM is not running.", { maxCommand: HOST_VM_MAX_COMMAND })
              : unreachable;
          }
          const desktop = channels.desktop;
          if (!desktop || !who) return unreachable;
          // the desktop this request named (its row says which), not one
          // that connects in the meantime
          const named = desktop.current(who);
          const desktopId = named?.id;
          const held = `${who}\n${desktopId ?? ""}`;
          /** That desktop now (connected, running a job), as far as known. */
          const now = () => {
            if (!desktopId) return null;
            if (desktop.state) return desktop.state(who, desktopId);
            return desktop.current(who)?.id === desktopId ? { online: true, busy: false } : null;
          };
          const send = (operation: Parameters<NonNullable<BranchChannels["desktop"]>["request"]>[1]) => inLane(`desktop\n${who}`, async () => {
            const until = stalled.get(held);
            if (until !== undefined) {
              // a job of its own still holds it: say so at once, nothing queued
              if (Date.now() < until && now()?.busy) throw desktopBusy();
              stalled.delete(held);
            }
            try {
              return await desktop.request(who, operation, desktopId);
            } catch (error) {
              // out of time (the bridge's refusal carries no code) while that
              // desktop stayed connected: busy (a job of its own was ahead of
              // this one, the app runs one at a time, or this one ran long),
              // not a closed app
              if ((error as { code?: unknown } | null)?.code === undefined && now()?.online) {
                stalled.set(held, Date.now() + STALL_MS);
                throw desktopBusy();
              }
              throw error;
            }
          });
          if (place.computer === "desktop") {
            // its login shell gets the line as one argument: a Mac has no cap
            // on one argument, a Linux desktop the kernel's (in bytes)
            return framedBranchExec((command, timeout) => send({ action: "run_command", command, timeout_seconds: timeout }), DESKTOP_CAPS, "Your computer is not connected.", { wrap: true, maxCommand: DESKTOP_MAX_COMMAND, ...(named?.platform === "darwin" ? {} : { maxBytes: ARGUMENT_MAX_BYTES }) });
          }
          // the Local VM runs it with `bash -lc` in Linux
          return framedBranchExec((command, timeout) => send({ action: "vm_run_command", command, timeout_seconds: timeout, ...(place.container ? { container: place.container } : {}) }), DESKTOP_VM_CAPS, "The Local VM is not running.", { maxCommand: DESKTOP_MAX_COMMAND, maxBytes: ARGUMENT_MAX_BYTES });
        }
        case "remote_session": {
          const sessions = channels.remoteSessions;
          const principal = who ?? (channels.organization ? undefined : sessions?.principalFor(botId, threadId));
          if (!sessions || !principal) return unreachable;
          // a client's computer: no variable (no token) is ever sent there,
          // and its login shell only starts /bin/sh
          const fits = (command: string) => viaPosixShell(command).trim().length <= REMOTE_SESSION_MAX_COMMAND;
          const exec: RemoteExec = async (command, timeoutMs) => {
            if (!fits(command)) return tooLong();
            const line = viaPosixShell(command);
            const result = await sessions.exec({ principalId: principal, botId, threadId, command: line, ...(timeoutMs ? { timeoutMs } : {}) });
            if ("error" in result) return /under 8,000 characters/.test(result.error) ? tooLong() : { error: result.error };
            // its own cut mark is a cut, never data (a status line cut short reads as cut)
            const stdout = sessionText(result.stdout);
            return {
              exitCode: result.exitCode,
              stdout: stdout.text,
              stderr: sessionText(result.stderr).text,
              ...(result.timedOut ? { timedOut: true } : {}),
              ...(stdout.cut ? { truncated: true } : {}),
            };
          };
          exec.fits = fits;
          return exec;
        }
        default:
          return unreachable;
      }
    },
  };
}
