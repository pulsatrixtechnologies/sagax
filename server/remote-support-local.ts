// Technician side of a Tailcat remote support session, on the computer this
// Sagax runs on (the desktop PC, or the bot's cloud computer). The private
// key is created once in this directory and never leaves it. Perspicax
// receives the public nodekey only. The model is not asked for either.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isTailcatAddress, TAILCAT_ADDRESS_MAX } from "../shared/remote-session.ts";
import { normPrincipal, supportFolderOwner } from "./remote-session-probe.ts";
import { resolveTailcatBinary } from "./tailcat-bin.ts";

/** Frozen template Perspicax renders (gateway remote_support::template). */
export const REMOTE_SUPPORT_TEMPLATE = "tailcat-0.7.0/2";
export const TECHNICIAN_MAX = 80;
const NODEKEY = /^nodekey:[0-9a-f]{64}$/;
const SESSION = /^[0-9a-f]{12}$/;
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_MS = 2 * 60 * 60 * 1000;
const MAX_MS = 24 * 60 * 60 * 1000;
const KEY_FILE = "technician.private.json";
const PUB_FILE = "technician.nodekey";
const MISSING = "tailcat is not installed with this Sagax, so the technician key cannot be created. The private key was not sent. Do not download tailcat and do not copy it into a system directory.";
const CREATE_FAILED = "The technician key could not be created on this computer. The private key was not sent.";

export interface TailcatRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: "missing";
}

/** One tailcat invocation. Tests pass a fake. The default spawns the binary Sagax ships and kills only that child. */
export type TailcatRun = (args: readonly string[], opts: { timeoutMs: number }) => Promise<TailcatRunResult>;

export interface RemoteSupportContext {
  dir: string;
  technicianName?: string;
  orgName?: string;
  now?: () => Date;
  run?: TailcatRun;
  sessionId?: () => string;
}

/** Who opened a session: written into open.json, checked before a tunnel resolves. */
export interface SupportOwner {
  principalId: string;
  botId: string;
}

export interface ToolAnswer {
  text: string;
  isError?: boolean;
}

/** The proxy env (server/index.ts agentsIntegration). Absent when the turn has no local directory. */
export function remoteSupportFromEnv(env: NodeJS.ProcessEnv): RemoteSupportContext | undefined {
  const dir = env.SAGAX_REMOTE_SUPPORT_DIR?.trim();
  if (!dir) return undefined;
  return {
    dir,
    technicianName: env.SAGAX_TECHNICIAN_NAME?.trim() ?? "",
    orgName: env.SAGAX_ORG_NAME?.trim() ?? "",
  };
}

/** Person name, then organization, within Perspicax's 80 character technician field. */
export function technicianLabel(person: string | undefined, org: string | undefined): string {
  return [person?.trim() ?? "", org?.trim() ?? ""].filter(Boolean).join(", ").slice(0, TECHNICIAN_MAX);
}

export function newSessionId(): string {
  return randomBytes(6).toString("hex");
}

/** Spawn tailcat and stop that child only. No shell. The command is an absolute path when Sagax can see its own copy. */
export function spawnTailcat(bin?: string): TailcatRun {
  return (args, { timeoutMs }) => new Promise((resolve) => {
    const command = bin ?? resolveTailcatBinary() ?? "tailcat";
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: TailcatRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: null, stdout, stderr });
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { if (stdout.length < 8192) stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { if (stderr.length < 8192) stderr += chunk; });
    child.on("error", (err: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr, ...(err.code === "ENOENT" ? { error: "missing" } : {}) }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}

const creating = new Map<string, Promise<{ ok: true; nodekey: string; keyPath: string } | { ok: false; error: string }>>();

function nodekeyFrom(text: string): string | null {
  const match = /nodekey:[0-9a-f]{64}/.exec(text);
  return match && NODEKEY.test(match[0]) ? match[0] : null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readPublic(path: string): Promise<string | null> {
  try {
    return nodekeyFrom(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Load the key created earlier, or create it once. Never returns the private half. */
export function ensureTechnicianNodekey(dir: string, run: TailcatRun) {
  const current = creating.get(dir);
  if (current) return current;
  const job = createOrLoad(dir, run).finally(() => { creating.delete(dir); });
  creating.set(dir, job);
  return job;
}

async function createOrLoad(dir: string, run: TailcatRun): Promise<{ ok: true; nodekey: string; keyPath: string } | { ok: false; error: string }> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const keyPath = join(dir, KEY_FILE);
  const pubPath = join(dir, PUB_FILE);
  const saved = await readPublic(pubPath);
  if (saved && await exists(keyPath)) return { ok: true, nodekey: saved, keyPath };
  if (await exists(keyPath)) {
    const printed = await run(["--key", keyPath, "printpub"], { timeoutMs: 15_000 });
    if (printed.error === "missing") return { ok: false, error: MISSING };
    const nodekey = nodekeyFrom(printed.stdout);
    if (!nodekey) return { ok: false, error: CREATE_FAILED };
    await writeFile(pubPath, `${nodekey}\n`, { mode: 0o600 });
    await chmod(pubPath, 0o600);
    await chmod(keyPath, 0o600);
    return { ok: true, nodekey, keyPath };
  }
  const created = await run(["genkey", "--client", "--key", keyPath], { timeoutMs: 15_000 });
  if (created.error === "missing") return { ok: false, error: MISSING };
  if (!await exists(keyPath)) return { ok: false, error: CREATE_FAILED };
  await chmod(keyPath, 0o600);
  const nodekey = nodekeyFrom(created.stdout);
  if (!nodekey) return { ok: false, error: CREATE_FAILED };
  await writeFile(pubPath, `${nodekey}\n`, { mode: 0o600 });
  await chmod(pubPath, 0o600);
  return { ok: true, nodekey, keyPath };
}

/** The public key already on disk, without creating one (a new key would not match a session already opened). */
export async function loadTechnicianKey(dir: string): Promise<{ nodekey: string; keyPath: string } | null> {
  const keyPath = join(dir, KEY_FILE);
  const nodekey = await readPublic(join(dir, PUB_FILE));
  if (!nodekey || !await exists(keyPath)) return null;
  return { nodekey, keyPath };
}

function endAt(raw: unknown, now: Date): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: new Date(now.getTime() + DEFAULT_MS).toISOString() };
  if (typeof raw !== "string" || !RFC3339.test(raw.trim())) {
    return { ok: false, error: "end_at must be an RFC 3339 date-time. Omit it for 2 hours from now, at most 24 hours." };
  }
  const parsed = Date.parse(raw.trim());
  if (!Number.isFinite(parsed)) return { ok: false, error: "end_at must be an RFC 3339 date-time." };
  if (parsed <= now.getTime()) return { ok: false, error: "end_at is already past." };
  return { ok: true, value: new Date(Math.min(parsed, now.getTime() + MAX_MS)).toISOString() };
}

/** Args Perspicax remote_support_open requires. Caller nodekey, template and session are ignored. */
export function prepareOpen(input: {
  args: Record<string, unknown>;
  nodekey: string;
  person?: string;
  org?: string;
  now: Date;
  sessionId: string;
}): { ok: true; args: Record<string, unknown>; session: string } | { ok: false; error: string } {
  if (!NODEKEY.test(input.nodekey)) return { ok: false, error: CREATE_FAILED };
  if (!SESSION.test(input.sessionId)) return { ok: false, error: "The session id could not be created." };
  const rights = input.args.rights;
  if (rights !== undefined && rights !== "standard" && rights !== "elevated") return { ok: false, error: "rights must be standard or elevated." };
  const os = input.args.os;
  if (os !== undefined && os !== null && os !== "windows" && os !== "macos" && os !== "linux") {
    return { ok: false, error: "os must be windows, macos, linux, or omitted so the page detects it." };
  }
  let start: number | undefined;
  if (input.args.start_minutes !== undefined && input.args.start_minutes !== null) {
    const minutes = input.args.start_minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 5 || minutes > 30) {
      return { ok: false, error: "start_minutes must be an integer from 5 to 30." };
    }
    start = minutes;
  }
  const end = endAt(input.args.end_at, input.now);
  if (!end.ok) return end;
  const requested = typeof input.args.technician === "string" ? input.args.technician.trim() : "";
  const technician = (requested || technicianLabel(input.person, input.org)).slice(0, TECHNICIAN_MAX);
  if (!technician) return { ok: false, error: "The technician name is missing. Sagax fills it from the person's name and the organization when the turn knows them." };
  const args: Record<string, unknown> = {
    template: REMOTE_SUPPORT_TEMPLATE,
    nodekey: input.nodekey,
    session: input.sessionId,
    rights: rights === "elevated" ? "elevated" : "standard",
    technician,
    end_at: end.value,
  };
  if (os === "windows" || os === "macos" || os === "linux") args.os = os;
  if (start !== undefined) args.start_minutes = start;
  return { ok: true, args, session: input.sessionId };
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

export function redact(text: string, hidden: readonly string[] = []): string {
  let out = text.replace(/privkey:[0-9a-f]+/gi, "privkey:redacted");
  for (const secret of hidden) {
    if (secret.length >= 8) out = out.split(secret).join("[kept on this computer]");
  }
  return out;
}

/** What the bot reads: the link and the code. Not the nodekey, not the address callback. */
export function presentOpen(raw: unknown): { ok: true; text: string; code: string } | { ok: false; error: string } {
  const obj = asObject(raw);
  const code = typeof obj?.code === "string" ? obj.code : "";
  const page = typeof obj?.page_url === "string" ? obj.page_url : "";
  if (!code || !page) return { ok: false, error: "Perspicax did not answer with a link and a code." };
  const lines = [`Link: ${page}`, `Code: ${code}`];
  const windows = typeof obj?.line_windows === "string" ? oneLine(obj.line_windows) : "";
  const unix = typeof obj?.line_unix === "string" ? oneLine(obj.line_unix) : "";
  if (windows) lines.push(`Windows: ${windows}`);
  if (unix) lines.push(`macOS or Linux: ${unix}`);
  if (windows || unix) {
    lines.push("", "Put this in your first reply exactly as written, fences included. Never run it or pass it through a shell on this computer (a Mac shell eats its $ variables).");
    if (windows) lines.push("", "Windows (PowerShell):", "```powershell", windows, "```");
    if (unix) lines.push("", "macOS or Linux (Terminal):", "```sh", unix, "```");
  }
  return { ok: true, text: lines.join("\n"), code };
}

/** A script line the end user pastes: one line, no fence that could close ours. */
function oneLine(value: string): string {
  // oxlint-disable-next-line no-control-regex -- a pasted line keeps no control characters
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("```", "").trim();
}

function compactCode(code: string): string | null {
  const compact = code.replace(/-/g, "").toUpperCase();
  return CODE.test(compact) ? compact : null;
}

/** What the open asked for, kept beside the session id so a card can be posted
 * after a restart. Never the address, never a key. */
export interface RememberedOpen {
  rights?: "standard" | "elevated";
  end_at?: string;
  os?: "windows" | "macos" | "linux";
  /** The person whose Perspicax credentials opened it, and the bot. */
  principalId?: string;
  botId?: string;
}

/** The owner is only ever the one the Sagax server attached to its answer
 * (`body.owner`, from the turn's Perspicax principal). The turn env is not
 * trusted: the engine launches this proxy and could set its environment, so a
 * forged `SAGAX_REMOTE_SUPPORT_PRINCIPAL` must never name the owner. When the
 * server named no owner, the folder stays ownerless. */
export function ownerOf(body: Record<string, unknown>): SupportOwner | null {
  const said = body.owner && typeof body.owner === "object" && !Array.isArray(body.owner) ? body.owner as Record<string, unknown> : null;
  const principalId = typeof said?.principalId === "string" ? said.principalId.trim() : "";
  const botId = typeof said?.botId === "string" ? said.botId.trim() : "";
  if (!principalId || !botId) return null;
  return { principalId: normPrincipal(principalId), botId };
}

/** False when the code's folder names another person or bot as its opener. */
function folderAllows(dir: string, code: string, owner: SupportOwner | null): boolean {
  const folder = supportFolderOwner(dir, code);
  if (!folder || (!folder.principalId && !folder.botId)) return true;
  return Boolean(owner) && folder.principalId === owner!.principalId && folder.botId === owner!.botId;
}

const NOT_YOURS = "That support code was opened by someone else on this computer. Open a new session with remote_support_open.";

export async function rememberSession(dir: string, code: string, session: string, open: RememberedOpen = {}): Promise<void> {
  const compact = compactCode(code);
  if (!compact || !SESSION.test(session)) return;
  const folder = join(dir, "sessions", compact);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  await writeFile(join(folder, "session"), `${session}\n`, { mode: 0o600 });
  const meta: RememberedOpen = {
    ...(open.rights === "elevated" ? { rights: "elevated" } : { rights: "standard" }),
    ...(typeof open.end_at === "string" ? { end_at: open.end_at } : {}),
    ...(open.os ? { os: open.os } : {}),
    ...(open.principalId?.trim() ? { principalId: normPrincipal(open.principalId) } : {}),
    ...(open.botId?.trim() ? { botId: open.botId.trim() } : {}),
  };
  await writeFile(join(folder, "open.json"), `${JSON.stringify(meta)}\n`, { mode: 0o600 });
}

/** The session id, rights, end and OS kept for a code by rememberSession, or null. */
export function recallSupportSession(dir: string, code: string): { id: string; code: string; elevated: boolean; endAt: string; os?: "windows" | "macos" | "linux"; principalId?: string; botId?: string } | null {
  const compact = compactCode(code);
  if (!compact) return null;
  const folder = join(dir, "sessions", compact);
  let id = "";
  let meta: RememberedOpen = {};
  try {
    id = readFileSync(join(folder, "session"), "utf8").trim();
  } catch {
    return null;
  }
  if (!SESSION.test(id)) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(folder, "open.json"), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as RememberedOpen;
  } catch {
    return null;
  }
  const end = typeof meta.end_at === "string" ? Date.parse(meta.end_at) : Number.NaN;
  if (!Number.isFinite(end)) return null;
  const os = meta.os === "windows" || meta.os === "macos" || meta.os === "linux" ? meta.os : undefined;
  const principalId = typeof meta.principalId === "string" && meta.principalId.trim() ? normPrincipal(meta.principalId) : undefined;
  const botId = typeof meta.botId === "string" && meta.botId.trim() ? meta.botId.trim() : undefined;
  return {
    id,
    code: compact,
    elevated: meta.rights === "elevated",
    endAt: new Date(end).toISOString(),
    ...(os ? { os } : {}),
    ...(principalId ? { principalId } : {}),
    ...(botId ? { botId } : {}),
  };
}

async function storeAddress(dir: string, code: string, address: string): Promise<boolean> {
  const compact = compactCode(code);
  if (!compact) return false;
  const folder = join(dir, "sessions", compact);
  // A session closed from the panel (or by remote_support_close) leaves a
  // `closed` marker: a late or repeated status never writes the address back.
  if (await exists(join(folder, "closed"))) return false;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const path = join(folder, "address");
  await writeFile(path, `${address}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return true;
}

export async function forgetAddress(dir: string, code: string): Promise<void> {
  const compact = compactCode(code);
  if (!compact) return;
  await rm(join(dir, "sessions", compact, "address"), { force: true });
}

/** Mark a code's session folder closed so its address stays gone: a later
 * status for the same code will not re-create it (storeAddress refuses). */
export async function markSessionClosed(dir: string, code: string): Promise<void> {
  const compact = compactCode(code);
  if (!compact) return;
  const folder = join(dir, "sessions", compact);
  try {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, "closed"), `${new Date().toISOString()}\n`, { mode: 0o600 });
    await rm(join(folder, "address"), { force: true });
  } catch { /* best effort: the card is already closed */ }
}

/** Drop the address from what the model reads. Ping with the local key when it is safe to connect. */
export async function absorbStatus(input: {
  dir: string;
  raw: unknown;
  code: string;
  run: TailcatRun;
  keyPath: string | null;
}): Promise<{ text: string; markConnected: boolean }> {
  const obj = asObject(input.raw);
  if (!obj) {
    const text = typeof input.raw === "string" ? redact(input.raw) : "Perspicax did not answer.";
    return { text, markConnected: false };
  }
  const leaked = typeof obj.fetch_ip_count === "number" && obj.fetch_ip_count > 1;
  const address = typeof obj.address === "string" ? obj.address : "";
  delete obj.address;
  delete obj.nodekey;
  if (leaked) {
    await forgetAddress(input.dir, input.code);
    obj.technician_side = "refused";
    return { text: redact(JSON.stringify(obj), address ? [address] : []), markConnected: false };
  }
  let side = "";
  if (address && isTailcatAddress(address)) {
    const stored = await storeAddress(input.dir, input.code, address);
    if (!stored || !input.keyPath) side = "missing";
    else {
      const ping = await input.run(["--key", input.keyPath, "ping", "--timeout=8s", address], { timeoutMs: 12_000 });
      side = ping.error === "missing" ? "missing" : ping.code === 0 ? "ready" : "failed";
    }
  } else if (address) {
    side = "failed";
    obj.technician_error = `Perspicax sent a tunnel address this computer does not accept (it must start with tc, have no spaces, and be at most ${TAILCAT_ADDRESS_MAX} characters). Close this session and open a new one.`;
  }
  if (side) obj.technician_side = side;
  return { text: redact(JSON.stringify(obj), address ? [address] : []), markConnected: side === "ready" };
}

function refused(status: number, body: Record<string, unknown>): string | null {
  if (status < 400 && !body.error && body.isError !== true) return null;
  return redact(String(body.text ?? body.error ?? "") || "Perspicax refused the call.");
}

/** One remote support tool call. The private key never enters `post` or the returned text. */
export async function handleRemoteSupportCall(input: {
  name: string;
  args: Record<string, unknown>;
  local: RemoteSupportContext;
  post: (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
}): Promise<ToolAnswer> {
  const run = input.local.run ?? spawnTailcat();
  if (input.name === "remote_support_open") return openCall(input, run);
  if (input.name === "remote_support_status") return statusCall(input, run);
  if (input.name === "remote_support_close") return closeCall(input);
  return { text: `Unknown tool: ${input.name}`, isError: true };
}

async function openCall(input: {
  args: Record<string, unknown>;
  local: RemoteSupportContext;
  post: (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
}, run: TailcatRun): Promise<ToolAnswer> {
  const key = await ensureTechnicianNodekey(input.local.dir, run);
  if (!key.ok) return { text: key.error, isError: true };
  const prepared = prepareOpen({
    args: input.args,
    nodekey: key.nodekey,
    person: input.local.technicianName,
    org: input.local.orgName,
    now: input.local.now?.() ?? new Date(),
    sessionId: input.local.sessionId?.() ?? newSessionId(),
  });
  if (!prepared.ok) return { text: prepared.error, isError: true };
  const posted = await input.post("remote_support_open", prepared.args);
  const error = refused(posted.status, posted.body);
  if (error) return { text: error, isError: true };
  const shown = presentOpen(posted.body.text);
  if (!shown.ok) return { text: shown.error, isError: true };
  const owner = ownerOf(posted.body);
  await rememberSession(input.local.dir, shown.code, prepared.session, {
    ...owner,
    rights: prepared.args.rights === "elevated" ? "elevated" : "standard",
    end_at: String(prepared.args.end_at),
    ...(prepared.args.os === "windows" || prepared.args.os === "macos" || prepared.args.os === "linux" ? { os: prepared.args.os } : {}),
  });
  return { text: shown.text };
}

async function statusCall(input: {
  args: Record<string, unknown>;
  local: RemoteSupportContext;
  post: (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
}, run: TailcatRun): Promise<ToolAnswer> {
  const code = typeof input.args.code === "string" ? input.args.code.trim() : "";
  if (!compactCode(code)) return { text: "code: the code remote_support_open answered.", isError: true };
  const forwarded: Record<string, unknown> = { code };
  if (input.args.mark_connected === true) forwarded.mark_connected = true;
  const posted = await input.post("remote_support_status", forwarded);
  const error = refused(posted.status, posted.body);
  if (error) return { text: error, isError: true };
  if (!folderAllows(input.local.dir, code, ownerOf(posted.body))) return { text: NOT_YOURS, isError: true };
  const key = await loadTechnicianKey(input.local.dir);
  const absorbed = await absorbStatus({ dir: input.local.dir, raw: posted.body.text, code, run, keyPath: key?.keyPath ?? null });
  if (!absorbed.markConnected || input.args.mark_connected === true) return { text: withConnectedNote(absorbed.text) };
  const again = await input.post("remote_support_status", { code, mark_connected: true });
  if (refused(again.status, again.body)) return { text: absorbed.text };
  const marked = await absorbStatus({ dir: input.local.dir, raw: again.body.text, code, run, keyPath: key?.keyPath ?? null });
  return { text: withConnectedNote(marked.text) };
}

export const CONNECTED_NOTE = "Connected. Sagax posts the session card and the live screen in this chat by itself. Tell the person it is connected. To look at the computer, call remote_session_snapshot (one call); to run a command, remote_session_exec. Do not write a screenshot to the Desktop and do not open Preview.";

/** A connected status tells the bot the card is coming, so it stops checking. */
function withConnectedNote(text: string): string {
  const obj = asObject(text);
  return obj?.state === "connected" ? `${text}\n${CONNECTED_NOTE}` : text;
}

async function closeCall(input: {
  args: Record<string, unknown>;
  local: RemoteSupportContext;
  post: (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
}): Promise<ToolAnswer> {
  const code = typeof input.args.code === "string" ? input.args.code.trim() : "";
  const outcome = input.args.outcome === "ended" || input.args.outcome === "cancelled" ? input.args.outcome : "";
  if (!compactCode(code) || !outcome) return { text: "code and outcome (ended or cancelled) are required.", isError: true };
  const posted = await input.post("remote_support_close", { code, outcome });
  const error = refused(posted.status, posted.body);
  if (error) return { text: error, isError: true };
  if (folderAllows(input.local.dir, code, ownerOf(posted.body))) await markSessionClosed(input.local.dir, code);
  const text = typeof posted.body.text === "string" && posted.body.text ? redact(posted.body.text) : "Done.";
  return { text };
}
