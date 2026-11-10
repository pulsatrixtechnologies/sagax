// The wrapper's side of a page's shared state (#1544, shared/page-state.ts):
// the page's script asks for the state and sets keys through
// window.sagax.page (STATE_BRIDGE_SOURCE in its frame); this reads the store
// from the server for every reader and writes it as the page's declaration
// allows (2026-10-29): with the reader's own session when they are signed in
// and may annotate, else on the public link itself with this browser's own
// random id (the server keeps only a hash of it). The server decides; the
// rules passed to the page only show or hide its controls. Only messages
// from the page's own frame are heard. The state is read again when the
// live stream says it changed, and every 20 s while the page is in view.
import { parseStateAccess, parseStateAnswer, parseStateSet, READER_ID, READER_ID_HEADER, STATE_ASK_MESSAGE, STATE_MESSAGE, STATE_PREFIX, STATE_RESULT_MESSAGE, stateWritable, type PageStateView, type StateAccess } from "../../shared/page-state";
import type { ReaderBoot } from "../../shared/page-reader";
import { readerApi, ReaderApiError } from "./api";

/** The reading link's token, from the wrapper's own address. Pure. */
export function viewToken(pathname: string): string | null {
  const match = /^\/pages\/view\/([^/]+)$/.exec(pathname);
  return match ? match[1]! : null;
}

export const STATE_LIVE_EVENT = "sagax-live-state";
const READER_ID_KEY = "sagax-page-reader";

/** This browser's own random id for pages it reads without signing in:
 * kept in this origin's storage when it can be, else for this visit only.
 * Nothing personal; the server keeps a hash of it. */
export function browserReaderId(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): string {
  try {
    const kept = storage?.getItem(READER_ID_KEY);
    if (kept && READER_ID.test(kept)) return kept;
  } catch { /* storage refused */ }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    storage?.setItem(READER_ID_KEY, id);
  } catch { /* this visit only */ }
  return id;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const POLL_MS = 20_000;

export function watchPageState(frame: HTMLIFrameElement | null, boot: ReaderBoot | null): () => void {
  const token = viewToken(location.pathname);
  if (!frame || !token) return () => undefined;
  const signedIn = Boolean(boot?.can.annotate && boot.pageId);
  const readerId = signedIn ? null : browserReaderId();
  const headers: Record<string, string> = readerId ? { [READER_ID_HEADER]: readerId } : {};
  let entries: Record<string, PageStateView> | null = null;
  let access: StateAccess | null = null;
  let me: string | undefined;
  // the page may have asked before this script started: tell it anyway, and
  // again whenever its frame loads
  let asked = true;
  const send = (message: Record<string, unknown>) => frame.contentWindow?.postMessage({ v: 1, ...message }, "*");
  const canWrite = () => (access ? stateWritable(access) : signedIn);
  const share = () => {
    if (entries && asked) send({ type: STATE_MESSAGE, entries, canWrite: canWrite(), ...(access ? { access } : {}), ...(me ? { me } : {}) });
  };
  const take = (body: unknown) => {
    const next = parseStateAnswer(body);
    if (!next) return false;
    entries = next;
    access = parseStateAccess((body as { access?: unknown }).access) ?? access;
    const handle = (body as { me?: unknown }).me;
    if (typeof handle === "string" && /^[\w-]{1,40}$/.test(handle)) me = handle;
    return true;
  };
  const load = async () => {
    try {
      if (take(await readerApi<unknown>(`${STATE_PREFIX}${token}`, { headers }))) share();
    } catch { /* the page keeps what it had */ }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    if ((event.data as { type?: unknown }).type === STATE_ASK_MESSAGE) {
      asked = true;
      if (entries) share();
      else void load();
      return;
    }
    const set = parseStateSet(event.data);
    if (!set) return;
    const answer = (ok: boolean, error?: string) => send({ type: STATE_RESULT_MESSAGE, id: set.id, ok, ...(error ? { error } : {}) });
    if (access && !stateWritable(access, set.key)) {
      const locked = access.locked.includes(set.key);
      const fr = boot?.lang === "fr";
      answer(false, locked ? (fr ? "Cette valeur est en lecture seule." : "This value is read-only.")
        : access.role === "anon" ? (fr ? "Connecte-toi pour modifier cette page." : "Sign in to change this page.")
          : (fr ? "Seule la personne de la page modifie cette valeur." : "Only the page's person changes this value."));
      return;
    }
    const path = signedIn ? `/api/pages/${encodeURIComponent(boot!.pageId!)}/state` : `${STATE_PREFIX}${token}`;
    void readerApi<unknown>(path, { method: "PUT", body: { key: set.key, value: set.value }, headers }).then((body) => {
      take(body);
      answer(true);
      share();
    }, (cause: unknown) => answer(false, cause instanceof ReaderApiError ? cause.message : String(cause)));
  };
  window.addEventListener("message", onMessage);
  window.addEventListener(STATE_LIVE_EVENT, load);
  frame.addEventListener("load", share);
  void load();
  const timer = setInterval(() => { if (asked && document.visibilityState === "visible") void load(); }, POLL_MS);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener(STATE_LIVE_EVENT, load);
    frame.removeEventListener("load", share);
    clearInterval(timer);
  };
}
