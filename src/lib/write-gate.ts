// While the window draws a stored snapshot (src/lib/ui-snapshot.ts), nothing
// it does may change the server: a write sent then would act on what the
// snapshot showed, not on what is true now (a read marker on a stale thread,
// a setting on a bot that moved). Every request of this page that is not a
// read waits here until the server's own snapshot has replaced the drawing,
// then goes out unchanged and in order. Reads go at once. A write aimed at a
// bot (/api/bots/<id>...) that the server's snapshot no longer lists is
// dropped at release: no network call, no error, an empty 200 for the caller.
let gate: { promise: Promise<void>; release: () => void } | null = null;
let liveBots: ReadonlySet<string> | null = null;
let installed = false;

function isWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  let url: URL;
  try {
    url = new URL(input instanceof Request ? input.url : String(input), location.href);
  } catch {
    return true;
  }
  return url.origin === location.origin;
}

function deletedBotTarget(input: RequestInfo | URL): boolean {
  if (!liveBots) return false;
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const match = /^\/api\/bots\/([^/]+)/.exec(url.pathname);
    return match !== null && !liveBots.has(decodeURIComponent(match[1]));
  } catch {
    return false;
  }
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const send = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const held = gate;
    if (held && isWrite(input, init)) return held.promise.then(() => (deletedBotTarget(input) ? new Response("{}", { status: 200 }) : send(input, init)));
    return send(input, init);
  };
}

/** From now until releaseWrites(), this page's writes wait. */
export function holdWrites(): void {
  if (gate) return;
  install();
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  gate = { promise, release };
}

/** Writes go again, those that waited first. With the server's bot ids, a
 * held write aimed at another bot is dropped instead of sent. */
export function releaseWrites(botIds?: Iterable<string>): void {
  const held = gate;
  if (!held) return;
  gate = null;
  liveBots = botIds ? new Set(botIds) : null;
  held.release();
}

export function writesHeld(): boolean {
  return gate !== null;
}
