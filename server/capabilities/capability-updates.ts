// #4504: what a person has installed (skills, plugins, connectors) and which
// of it has a newer version at its source, with update one and update all.
//
// One service for the page (GET and POST /api/me/capability-updates) and for
// the bots (sagax_settings capabilities.updates replays the same routes). Each
// kind is a provider: it lists the person's installed items from the stores
// that already exist, checks its sources (network, never during a turn or a
// page read: in the background) and updates one item through the existing
// install path. A source that cannot be reached leaves the item as it was:
// never an error shown to the person.
//
// What the organization declares (required or offered, a pinned version)
// is listed with `organization` and `canUpdate: false`: the organization
// console decides its version, so an update of it answers failed with that
// reason.

export type UpdateKind = "plugin" | "skill" | "connector";
export type UpdateScope = "me" | "bot" | "installation" | "organization";

export interface UpdateItem {
  /** Stable, never shown: `<kind>:<scope>:<target>:<id>`. */
  key: string;
  kind: UpdateKind;
  /** Readable. */
  name: string;
  scope: UpdateScope;
  bot?: { id: string; name: string };
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable: boolean;
  updateNotes?: string;
  /** The source was never reached: no update mark, and an update answers unknown. */
  updateUnknown?: true;
  organization?: "required" | "offered";
  /** The organization's declaration id, for the person's own switch of it
   * (PUT /api/me/org-capabilities/:id). */
  organizationId?: string;
  pinned?: string;
  canUpdate: boolean;
}

export interface UpdatesView {
  count: number;
  checkedAt: number | null;
  checking: boolean;
  items: UpdateItem[];
}

export interface UpdateResult {
  key: string;
  kind: UpdateKind;
  name: string;
  status: "updated" | "current" | "failed" | "unknown";
  from?: string;
  to?: string;
  updateNotes?: string;
  error?: string;
}

/** Who asks: the signed-in person, whether they manage this installation
 * (solo: the operator), and `context` passed through to the providers (the
 * request's auth, for the existing install paths). */
export interface UpdatePerson {
  id: string;
  manager: boolean;
  context?: unknown;
}

export interface UpdateProvider {
  kind: UpdateKind;
  /** The person's installed items of this kind, from what is known now. */
  items(person: UpdatePerson): Promise<UpdateItem[]> | UpdateItem[];
  /** Ask the sources again (network). True when something it knows changed. */
  check(): Promise<boolean>;
  /** Update one item through the existing install path; throws with a
   * readable reason, and then the old version stays installed. */
  update(person: UpdatePerson, item: UpdateItem): Promise<{ to?: string; notes?: string } | void>;
  /** The least time between two checks of this kind (default STALE_AFTER_MS). */
  checkEvery?: number;
}

/** The live frame a person's app reads again on (the SSE stream). */
export const CAPABILITY_UPDATES_FRAME = "capability.updates";

/** The frame reaches the person it names only (a stream without a viewer
 * is this computer's own person). */
export function capabilityUpdatesFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== CAPABILITY_UPDATES_FRAME) return true;
  return typeof payload.audience === "string" && payload.audience === (viewerId || localPersonId);
}

/** A read of the list starts a background check past this age. */
export const STALE_AFTER_MS = 30 * 60_000;
/** The periodic check. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
/** The first check, never sooner after start (start-up resumes cut turns). */
export const FIRST_CHECK_DELAY_MS = 5 * 60_000;
/** A random share of this is added to every wait. */
export const CHECK_SPREAD_MS = 15 * 60_000;
/** Notes are a short paragraph, never a wall of text. */
export const NOTES_MAX_CHARS = 600;

export function updateKey(kind: UpdateKind, scope: UpdateScope, target: string, id: string): string {
  return `${kind}:${scope}:${target}:${id}`;
}

/** Plain, one paragraph, at most NOTES_MAX_CHARS characters. */
export function shortNotes(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (!plain) return undefined;
  return plain.length > NOTES_MAX_CHARS ? `${plain.slice(0, NOTES_MAX_CHARS - 3).trimEnd()}...` : plain;
}

/** Compare two dotted versions ("1.10.0" > "1.9.2"); a pre-release sorts
 * before its release. Null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string) => /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(value.trim());
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  const xs = x[1]!.split(".").map(Number);
  const ys = y[1]!.split(".").map(Number);
  for (let index = 0; index < Math.max(xs.length, ys.length); index += 1) {
    const diff = (xs[index] ?? 0) - (ys[index] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (x[2] && !y[2]) return -1;
  if (!x[2] && y[2]) return 1;
  if (!x[2] || !y[2]) return 0;
  // pre-release identifiers: numbers by value (rc.10 after rc.9), words by text
  const xp = x[2].split(".");
  const yp = y[2].split(".");
  for (let index = 0; index < Math.max(xp.length, yp.length); index += 1) {
    const left = xp[index];
    const right = yp[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const numeric = /^\d+$/.test(left) && /^\d+$/.test(right);
    const diff = numeric ? Number(left) - Number(right) : left.localeCompare(right);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

import { GithubAccessError } from "../github/github-access.ts";

// ── connectors: a command server pinned to a package version ──────────

/** A command MCP server that runs one package at one version: `npx -y
 * pkg@1.2.3`, `bunx pkg@1.2.3`, `pnpm dlx pkg@1.2.3`, `npm exec pkg@1.2.3`,
 * `uvx pkg==1.2.3` or `uvx pkg@1.2.3`. Unpinned packages follow their
 * source on every start already: nothing to update. */
export interface PinnedPackage {
  registry: "npm" | "pypi";
  name: string;
  version: string;
  /** The index in args of the pinned argument. */
  arg: number;
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?$/;

export function pinnedPackage(command: string, args: readonly string[]): PinnedPackage | null {
  const program = command.trim().split(/[\\/]/).pop()?.replace(/\.(?:cmd|exe)$/i, "") ?? "";
  const runner = program === "npx" || program === "bunx" ? "npm"
    : (program === "pnpm" && args[0] === "dlx") || (program === "npm" && args[0] === "exec") ? "npm"
      : program === "uvx" ? "pypi" : null;
  if (!runner) return null;
  const start = program === "pnpm" || program === "npm" ? 1 : 0;
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      // an option with its value (--package x, --from x): the value is not the program
      if (/^--(?:package|from|with|python|registry|cache|prefix)$/.test(arg) || arg === "-p") index += 1;
      continue;
    }
    if (runner === "npm") {
      const at = arg.lastIndexOf("@");
      if (at <= 0) return null;
      const name = arg.slice(0, at);
      const version = arg.slice(at + 1);
      return NPM_NAME.test(name) && VERSION.test(version) ? { registry: "npm", name, version, arg: index } : null;
    }
    const pin = /^([^=@<>!~]+)(?:==|@)(.+)$/.exec(arg);
    if (!pin) return null;
    const [, name, version] = pin;
    return PYPI_NAME.test(name!) && VERSION.test(version!) ? { registry: "pypi", name: name!, version: version!, arg: index } : null;
  }
  return null;
}

/** The same args with the pinned package at `version`. */
export function withPinnedVersion(args: readonly string[], pin: PinnedPackage, version: string): string[] {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version`);
  const next = [...args];
  const current = next[pin.arg] ?? "";
  next[pin.arg] = pin.registry === "pypi" && current.includes("==") ? `${pin.name}==${version}` : `${pin.name}@${version}`;
  return next;
}

/** The newest release of a package at its registry, or null when it cannot
 * be told (unreachable, unknown, not a version). Never throws. */
export async function latestPackageVersion(pin: Pick<PinnedPackage, "registry" | "name">, fetcher: typeof fetch = fetch, timeoutMs = 8_000): Promise<string | null> {
  const url = pin.registry === "npm"
    ? `https://registry.npmjs.org/${pin.name.startsWith("@") ? `@${encodeURIComponent(pin.name.slice(1))}` : encodeURIComponent(pin.name)}/latest`
    : `https://pypi.org/pypi/${encodeURIComponent(pin.name)}/json`;
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = await response.json() as { version?: unknown; info?: { version?: unknown } };
    const version = pin.registry === "npm" ? body.version : body.info?.version;
    return typeof version === "string" && VERSION.test(version) ? version : null;
  } catch {
    return null;
  }
}

// ── skills: a folder imported from GitHub ─────────────────────────────

export interface FolderCommit {
  sha: string;
  /** ISO date the commit landed (committer date). */
  date: string;
  message: string;
}

/** What one read of a folder's commits answered: the commits (newest
 * first) and GitHub's rate window, a refusal for the rate limit with its
 * reset, or null when GitHub could not be read. Never throws. */
export type FolderCommitsAnswer =
  | { commits: FolderCommit[]; remaining?: number; resetAt?: number }
  | { limitedUntil: number }
  | null;

export async function latestFolderCommits(
  origin: { owner: string; repo: string; ref: string; path: string },
  fetcher: typeof fetch = fetch,
  timeoutMs = 8_000,
  now: () => number = Date.now,
): Promise<FolderCommitsAnswer> {
  const query = new URLSearchParams({ per_page: "10" });
  if (origin.ref && origin.ref !== "HEAD") query.set("sha", origin.ref);
  if (origin.path) query.set("path", origin.path);
  const url = `https://api.github.com/repos/${encodeURIComponent(origin.owner)}/${encodeURIComponent(origin.repo)}/commits?${query}`;
  try {
    const response = await fetcher(url, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(timeoutMs) });
    const remainingHeader = response.headers?.get?.("x-ratelimit-remaining");
    const resetHeader = response.headers?.get?.("x-ratelimit-reset");
    const remaining = remainingHeader !== null && remainingHeader !== undefined && /^\d+$/.test(remainingHeader) ? Number(remainingHeader) : undefined;
    const resetAt = resetHeader && /^\d+$/.test(resetHeader) ? Number(resetHeader) * 1000 : undefined;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryHeader = response.headers?.get?.("retry-after");
      const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? now() + Number(retryHeader) * 1000 : undefined;
      // a secondary limit says retry-after, even with requests left
      if (response.status === 429 || (response.status === 403 && (remaining === 0 || retryAfter !== undefined))) return { limitedUntil: retryAfter ?? resetAt ?? now() + 60 * 60_000 };
      return null;
    }
    const body = await response.json() as unknown;
    if (!Array.isArray(body)) return null;
    const commits = body.flatMap((row) => {
      const r = row as { sha?: unknown; commit?: { message?: unknown; committer?: { date?: unknown } } };
      return typeof r.sha === "string" && /^[0-9a-f]{40}$/.test(r.sha)
        ? [{ sha: r.sha, date: typeof r.commit?.committer?.date === "string" ? r.commit.committer.date : "", message: typeof r.commit?.message === "string" ? r.commit.message : "" }]
        : [];
    });
    return { commits, ...(remaining !== undefined ? { remaining } : {}), ...(resetAt !== undefined ? { resetAt } : {}) };
  } catch (error) {
    // the server's GitHub wrapper (githubSkillFetch) throws its rate limit
    if (error instanceof GithubAccessError && error.failure.code === "rate_limited") return { limitedUntil: error.failure.resetAt ?? now() + 60 * 60_000 };
    return null;
  }
}

/** Whether a skill imported at `commit` on `importedAt` is behind its
 * folder's commits: the ones that landed after the import and are not the
 * imported commit itself. Their first lines are the notes. */
export function skillFolderUpdate(installed: { commit: string; importedAt: string }, commits: readonly FolderCommit[]): { available: string; notes?: string } | null {
  const since = Date.parse(installed.importedAt);
  // the imported commit touched the folder: everything above it is newer, whatever its date
  const at = commits.findIndex((commit) => commit.sha === installed.commit);
  const newer = at >= 0
    ? commits.slice(0, at)
    : commits.filter((commit) => Number.isFinite(since) && Date.parse(commit.date) > since);
  if (!newer.length) return null;
  const notes = shortNotes(newer.map((commit) => commit.message.split("\n")[0]!.trim()).filter(Boolean).join("\n"));
  return { available: newer[0]!.sha.slice(0, 7), ...(notes ? { notes } : {}) };
}

// ── the service ───────────────────────────────────────────────────────

export interface CapabilityUpdatesOptions {
  providers: readonly UpdateProvider[];
  now?: () => number;
  random?: () => number;
  /** People with installed items besides those who read their list (the
   * bots' owners), with the same manager flag their own GET has. */
  people?: () => UpdatePerson[];
  /** Tell one person their list changed (the live frame), with the view
   * their own GET answers. */
  notify?: (personId: string, view: UpdatesView, autoUpdated?: UpdateResult[]) => void;
  /** Update by itself the plugins of the person's own places when a check
   * finds a newer version (the catalog moved): no question, one line to the
   * person of what changed. Off when absent. */
  autoUpdate?: { kinds: readonly UpdateKind[] };
  log?: (line: string) => void;
}

export class CapabilityUpdates {
  private readonly options: CapabilityUpdatesOptions;
  private readonly lastCheck = new Map<UpdateKind, number>();
  private readonly running = new Map<UpdateKind, Promise<void>>();
  private checkedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** The people who read their list or updated, as their GET saw them. */
  private readonly seen = new Map<string, UpdatePerson>();
  /** What each person was last told (or read), to send only a change. */
  private readonly told = new Map<string, string>();
  /** One update of one item at a time; a second ask joins the first. */
  private readonly inflight = new Map<string, Promise<UpdateResult>>();
  /** `person key version` already tried by the automatic update: a failure is
   * not tried again until the source has a newer version. */
  private readonly autoTried = new Set<string>();

  constructor(options: CapabilityUpdatesOptions) {
    this.options = options;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private log(line: string): void {
    (this.options.log ?? ((text: string) => console.warn(text)))(line);
  }

  /** Every installed item of this person, the count of updates, and a
   * background check of each stale kind (never awaited). */
  async list(person: UpdatePerson): Promise<UpdatesView> {
    this.remember(person);
    this.checkStale();
    const view = await this.view(person);
    this.told.set(person.id, signature(view));
    return view;
  }

  private async view(person: UpdatePerson): Promise<UpdatesView> {
    const items = await this.items(person);
    return {
      count: items.filter((item) => item.updateAvailable && item.canUpdate).length,
      checkedAt: this.checkedAt,
      checking: this.running.size > 0,
      items,
    };
  }

  private remember(person: UpdatePerson): void {
    this.seen.set(person.id, { id: person.id, manager: person.manager });
  }

  /** Send the live frame to each person whose list changed since they
   * were last told or last read it. */
  private async notifyPeople(only?: UpdatePerson, autoUpdated?: ReadonlyMap<string, UpdateResult[]>): Promise<void> {
    if (!this.options.notify) return;
    const people = new Map<string, UpdatePerson>();
    if (only) people.set(only.id, only);
    else {
      for (const person of this.options.people?.() ?? []) people.set(person.id, person);
      for (const person of this.seen.values()) people.set(person.id, person);
    }
    for (const person of people.values()) {
      try {
        const view = await this.view(person);
        const now = signature(view);
        const before = this.told.get(person.id);
        this.told.set(person.id, now);
        // never told before (right after a start): an update to show is news
        const updated = autoUpdated?.get(person.id);
        if (updated?.length || (before === undefined ? view.count > 0 : before !== now)) this.options.notify(person.id, view, updated);
      } catch (error) {
        this.log(`[capability-updates] the live frame could not be built: ${reason(error)}`);
      }
    }
  }

  private async items(person: UpdatePerson): Promise<UpdateItem[]> {
    const lists = await Promise.all(this.options.providers.map(async (provider) => {
      try {
        return await provider.items(person);
      } catch (error) {
        this.log(`[capability-updates] ${provider.kind} items could not be read: ${reason(error)}`);
        return [];
      }
    }));
    return lists.flat();
  }

  /** Start the checks whose last run is older than their period. */
  checkStale(): void {
    const now = this.now();
    for (const provider of this.options.providers) {
      const last = this.lastCheck.get(provider.kind);
      if (last === undefined || now - last >= (provider.checkEvery ?? STALE_AFTER_MS)) void this.checkKind(provider);
    }
  }

  /** The automatic update: the person's own items of `kind` (their personal
   * place and their bots') that have an update, one at a time through the
   * same path as the page's Update. The organization's items (the console
   * decides their version) and this installation's shared ones (they need an
   * administrator's request) are left to their own flows. */
  private async autoUpdate(kind: UpdateKind): Promise<Map<string, UpdateResult[]>> {
    const done = new Map<string, UpdateResult[]>();
    const people = new Map<string, UpdatePerson>();
    for (const person of this.options.people?.() ?? []) people.set(person.id, person);
    for (const person of this.seen.values()) people.set(person.id, person);
    for (const person of people.values()) {
      let items: UpdateItem[];
      try {
        items = (await this.items(person)).filter((item) => item.kind === kind && item.updateAvailable && item.canUpdate && !item.updateUnknown && (item.scope === "me" || item.scope === "bot"));
      } catch {
        continue;
      }
      for (const item of items) {
        const tried = `${person.id}\u0000${item.key}\u0000${item.availableVersion ?? ""}`;
        if (this.autoTried.has(tried)) continue;
        this.autoTried.add(tried);
        const result = await this.updateOne(person, item);
        if (result.status === "updated") done.set(person.id, [...(done.get(person.id) ?? []), result]);
        else if (result.status === "failed") this.log(`[capability-updates] automatic update of ${item.name} failed, the old version stays: ${result.error ?? ""}`);
      }
    }
    return done;
  }

  /** Check every kind now (single flight per kind). */
  async check(): Promise<void> {
    await Promise.all(this.options.providers.map((provider) => this.checkKind(provider)));
  }

  private checkKind(provider: UpdateProvider): Promise<void> {
    const running = this.running.get(provider.kind);
    if (running) return running;
    this.lastCheck.set(provider.kind, this.now());
    const run = (async () => {
      let changed = false;
      try {
        changed = await provider.check();
      } catch (error) {
        // a source that cannot be reached is not the person's error
        this.log(`[capability-updates] ${provider.kind} sources could not be checked, nothing changed: ${reason(error)}`);
      } finally {
        this.running.delete(provider.kind);
      }
      this.checkedAt = this.now();
      const auto = this.options.autoUpdate?.kinds.includes(provider.kind) ? await this.autoUpdate(provider.kind) : new Map<string, UpdateResult[]>();
      if (changed || auto.size) await this.notifyPeople(undefined, auto);
    })();
    this.running.set(provider.kind, run);
    return run;
  }

  /** Update the items named by `keys`, or every item with an update. One
   * at a time; a failure is that item's result and the next goes on. */
  async apply(person: UpdatePerson, request: { keys?: readonly string[]; all?: boolean }): Promise<{ results: UpdateResult[]; count: number }> {
    this.remember(person);
    const items = await this.items(person);
    const byKey = new Map(items.map((item) => [item.key, item]));
    const chosen: Array<{ key: string; item?: UpdateItem }> = request.all
      ? items.filter((item) => item.updateAvailable && item.canUpdate).map((item) => ({ key: item.key, item }))
      : [...new Set(request.keys ?? [])].map((key) => ({ key, item: byKey.get(key) }));
    const results: UpdateResult[] = [];
    for (const { key, item } of chosen) {
      if (!item) {
        results.push({ key, kind: kindOfKey(key), name: key.split(":").slice(3).join(":") || key, status: "failed", error: "Not one of your installed items: get the list again." });
        continue;
      }
      // a key in a person's own place does not name the person: theirs is in the in-flight key
      const flight = `${person.id}\u0000${key}`;
      let running = this.inflight.get(flight);
      if (!running) {
        running = this.updateOne(person, item).finally(() => this.inflight.delete(flight));
        this.inflight.set(flight, running);
      }
      results.push(await running);
    }
    const count = (await this.items(person)).filter((row) => row.updateAvailable && row.canUpdate).length;
    if (results.length) await this.notifyPeople({ id: person.id, manager: person.manager });
    return { results, count };
  }

  private async updateOne(person: UpdatePerson, item: UpdateItem): Promise<UpdateResult> {
    const base = { key: item.key, kind: item.kind, name: item.name, ...(item.installedVersion ? { from: item.installedVersion } : {}) };
    // the organization's own item: canUpdate is its one verdict (the providers set it)
    if (!item.canUpdate) return { ...base, status: "failed", error: "Your organization manages this one: its version follows the organization console." };
    if (item.updateUnknown) return { ...base, status: "unknown", error: "Its source has not answered yet: nothing is known about a newer version." };
    if (!item.updateAvailable) return { ...base, status: "current" };
    const provider = this.options.providers.find((candidate) => candidate.kind === item.kind);
    try {
      if (!provider) throw new Error("This kind cannot be updated here.");
      const done = await provider.update(person, item);
      const to = done?.to ?? item.availableVersion;
      const notes = shortNotes(done?.notes) ?? item.updateNotes;
      return { ...base, status: "updated", ...(to ? { to } : {}), ...(notes ? { updateNotes: notes } : {}) };
    } catch (error) {
      return { ...base, status: "failed", error: `${reason(error)} The installed version still works.` };
    }
  }

  /** The periodic check: first past FIRST_CHECK_DELAY_MS, then every
   * CHECK_INTERVAL_MS, each wait spread at random. */
  start(): { stop(): void } {
    const random = this.options.random ?? Math.random;
    const schedule = (delay: number) => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.check().finally(() => schedule(CHECK_INTERVAL_MS + Math.floor(random() * CHECK_SPREAD_MS)));
      }, delay);
      this.timer.unref?.();
    };
    schedule(FIRST_CHECK_DELAY_MS + Math.floor(random() * CHECK_SPREAD_MS));
    return {
      stop: () => {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
      },
    };
  }
}

function signature(view: UpdatesView): string {
  return JSON.stringify([view.count, view.items.map((item) => [item.key, item.updateAvailable, item.availableVersion ?? null, item.updateUnknown ?? false])]);
}

function kindOfKey(key: string): UpdateKind {
  const kind = key.split(":")[0];
  return kind === "plugin" || kind === "skill" || kind === "connector" ? kind : "plugin";
}

function reason(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 300);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
