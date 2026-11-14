import { stat } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { join } from "node:path";

import { resolveTarget } from "../browser/egress/gate.ts";
import { execChild } from "../process/spawn-helper.ts";
import { addressClass, ownAddresses } from "../browser/egress/policy.ts";

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

export interface ProcessEntry {
  pid: number;
  name: string;
}

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}

export async function fileStamp(path: string): Promise<FileStamp | null> {
  try {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

export function fileChanged(before: FileStamp | null, now: FileStamp | null): boolean {
  if (!now) return false;
  if (!before) return true;
  return before.size !== now.size || before.mtimeMs !== now.mtimeMs;
}

export function parsePs(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const name = match[2].slice(match[2].lastIndexOf("/") + 1);
    if (name) entries.push({ pid: Number(match[1]), name });
  }
  return entries;
}

export function parseTasklist(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)"/.exec(line);
    if (match) entries.push({ pid: Number(match[2]), name: match[1] });
  }
  return entries;
}

// #3680: through the spawn helper, so a wait's process list never forks the server.
function runFile(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execChild(file, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function listProcesses(
  platform: NodeJS.Platform = process.platform,
  run: (file: string, args: string[]) => Promise<string> = runFile,
): Promise<ProcessEntry[]> {
  if (platform === "win32") return parseTasklist(await run("tasklist", ["/fo", "csv", "/nh"]));
  return parsePs(await run("ps", ["-axo", "pid=,comm="]));
}

export function processRunning(entries: readonly ProcessEntry[], wanted: string): boolean {
  const target = wanted.trim();
  if (/^\d+$/.test(target)) return entries.some((entry) => entry.pid === Number(target));
  const lower = target.toLowerCase();
  const withExe = lower.endsWith(".exe") ? lower : `${lower}.exe`;
  const withoutExe = lower.endsWith(".exe") ? lower.slice(0, -4) : lower;
  return entries.some((entry) => {
    const name = entry.name.toLowerCase();
    if (name === lower || name === withExe || name === withoutExe) return true;
    return name.length === 15 && name === lower.slice(0, 15);
  });
}

// ── one reader (#4250, S5 step c) ──────────────────────────────────────

/** What one probe reads: a page and a text, a file, or a program. */
export type ProbeTarget =
  | { kind: "page"; url: string; text: string }
  | { kind: "file"; path: string }
  | { kind: "process"; name: string };

/** Where a probe reads from (replaced in tests). */
export interface ProbeReaders {
  page(url: string): Promise<PageResult>;
  stamp(path: string): Promise<FileStamp | null>;
  processes(): Promise<ProcessEntry[]>;
}

/** What it found: whether the page says the text (or why it could not be
 * read), the file's stamp (null: absent), whether the program runs (or that
 * the list could not be read). */
export type ProbeReading =
  | { kind: "page"; ok: true; says: boolean }
  | { kind: "page"; ok: false; page: Extract<PageResult, { ok: false }> }
  | { kind: "file"; stamp: FileStamp | null }
  | { kind: "process"; listed: true; running: boolean }
  | { kind: "process"; listed: false };

/** #4250 (S5 `one-probe-engine`, step c): the one reader of a page, a file
 * or a program, shared by wait_until (server/waits/waits.ts) and the
 * HEARTBEAT.md checklist (server/heartbeat/heartbeat.ts). Each caller
 * decides what the reading means for it. Never throws. */
export async function readProbe(target: ProbeTarget, readers: ProbeReaders): Promise<ProbeReading> {
  if (target.kind === "page") {
    let page: PageResult;
    try {
      page = await readers.page(target.url);
    } catch (error) {
      page = { ok: false, refused: false, error: error instanceof Error ? error.message : String(error) };
    }
    return page.ok ? { kind: "page", ok: true, says: pageSays(page.text, target.text) } : { kind: "page", ok: false, page };
  }
  if (target.kind === "file") return { kind: "file", stamp: await readers.stamp(target.path).catch(() => null) };
  try {
    return { kind: "process", listed: true, running: processRunning(await readers.processes(), target.name) };
  } catch {
    return { kind: "process", listed: false };
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, body: string) => {
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named !== undefined) return named;
    if (body[0] !== "#") return whole;
    const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

/** `<script` or `<style` as a whole tag name: an element whose text a page never shows. */
const HIDDEN_OPEN = /<(script|style)(?!\w)/iy;
const HIDDEN_CLOSE: Record<string, RegExp> = { script: /<\/script[\s/>]/gi, style: /<\/style[\s/>]/gi };

/**
 * Where the markup starting with the `<` at `open` ends (just past it), or -1 when that `<` is text: no `>` follows
 * anywhere, so no later `<` starts a tag either. A comment, script or style left open runs to the end, as in a browser.
 */
function markupEnd(body: string, open: number): number {
  if (body.startsWith("<!--", open)) {
    const close = body.indexOf("-->", open + 2);
    return close === -1 ? body.length : close + 3;
  }
  const close = body.indexOf(">", open + 1);
  if (close === -1) return -1;
  HIDDEN_OPEN.lastIndex = open;
  const hidden = HIDDEN_OPEN.exec(body)?.[1]?.toLowerCase();
  if (!hidden) return close + 1;
  const end = HIDDEN_CLOSE[hidden]!;
  end.lastIndex = close + 1;
  const found = end.exec(body);
  const after = found ? body.indexOf(">", found.index) : -1;
  return after === -1 ? body.length : after + 1;
}

/**
 * A page's words: tags, comments, scripts and styles out, entities decoded, spaces collapsed. One linear pass, so a
 * hostile 2 MB page costs milliseconds (the patterns this replaced backtracked, and took minutes on a page of `<`).
 */
export function pageText(body: string): string {
  const words: string[] = [];
  for (let at = 0; at < body.length;) {
    const open = body.indexOf("<", at);
    const end = open === -1 ? -1 : markupEnd(body, open);
    if (end === -1) {
      words.push(body.slice(at));
      break;
    }
    words.push(body.slice(at, open), " ");
    at = end;
  }
  return decodeEntities(words.join("")).replace(/\s+/g, " ").trim();
}

export function pageSays(text: string, wanted: string): boolean {
  const needle = wanted.replace(/\s+/g, " ").trim().toLowerCase();
  return text.toLowerCase().includes(needle);
}

export const PAGE_TIMEOUT_MS = 15_000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_MAX_REDIRECTS = 3;

type Failure = { ok: false; refused: boolean; error: string };
export type PageResult = { ok: true; text: string } | Failure;
/** The 2xx answer a redirect chain ended on: its address, headers and at most `maxBytes` of its body. */
export type PublicPage = { ok: true; url: URL; headers: IncomingHttpHeaders; body: Buffer } | Failure;

export interface PageFetchOptions {
  allow?: (target: { host: string; address: string }) => boolean;
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

type Answer = { status: number; location?: string; headers: IncomingHttpHeaders; body: Buffer };

const fail = (error: string, refused = false): Failure => ({ ok: false, refused, error });

function requestOnce(url: URL, address: { address: string; family: number }, signal: AbortSignal, maxBytes: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_host, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        agent: false,
        signal,
        lookup: pinned,
        headers: { "user-agent": "Sagax-wait", accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const { headers } = response;
        if (status < 200 || status >= 300) {
          response.destroy();
          resolve({ status, location: headers.location, headers, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= maxBytes) {
            response.destroy();
            resolve({ status, headers, body: Buffer.concat(chunks).subarray(0, maxBytes) });
          }
        });
        response.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks) }));
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function withinSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function fetchPageText(rawUrl: string, options: PageFetchOptions = {}): Promise<PageResult> {
  const page = await fetchPublicPage(rawUrl, options);
  return page.ok ? { ok: true, text: pageText(page.body.toString("utf8")) } : page;
}

/** Security: only a public address, checked again on every redirect and pinned for the request, so a page can't
 * point this server at itself or a private network. */
export async function fetchPublicPage(rawUrl: string, options: PageFetchOptions = {}): Promise<PublicPage> {
  const lookup = options.lookup ?? resolveTarget;
  const allow = options.allow ?? (({ address }) => addressClass(address, ownAddresses()) === "public");
  const maxBytes = options.maxBytes ?? PAGE_MAX_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? PAGE_TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("That is not a web address.", true);
  }
  try {
    for (let hop = 0; ; hop++) {
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        return fail("Only an http or https address with no sign-in details can be checked.", true);
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const literal = isIP(host);
      const addresses = literal ? [{ address: host, family: literal }] : await withinSignal(lookup(host), signal);
      if (addresses.length === 0) return fail("That address could not be found.");
      if (!addresses.every(({ address }) => allow({ host, address }))) {
        return fail(`${host} points at this computer or a private network, which waits never check. Use a page on the public web.`, true);
      }
      signal.throwIfAborted();
      const answer = await requestOnce(url, addresses[0], signal, maxBytes);
      if (answer.status >= 300 && answer.status < 400 && answer.location) {
        if (hop >= (options.maxRedirects ?? PAGE_MAX_REDIRECTS)) return fail("The page redirected too many times.");
        url = new URL(answer.location, url);
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) return fail(`The page answered ${answer.status}.`);
      return { ok: true, url, headers: answer.headers, body: answer.body };
    }
  } catch {
    return signal.aborted ? fail("The page took too long to answer.") : fail("The page could not be reached.");
  }
}
