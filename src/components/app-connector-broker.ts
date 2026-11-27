// The host broker for a chat app's capability bridge (R6). The sandboxed
// frame posts sagax-cap. This answers with the viewer's session. Only
// connector.call is carried out, through the same route as a published
// page's call. A message from any other window, or any other origin than
// the sandbox's opaque "null", is ignored. The frame's own gesture flag is
// not a click: only the browser's user activation is.
import {
  CAP_HELLO_MESSAGE,
  CAP_READY_MESSAGE,
  CAP_RESULT_MESSAGE,
  CAP_TAKEN_MESSAGE,
  pageCapCallId,
  pageCapGranted,
  parsePageCapRequest,
  type PageCapabilities,
  type PageCapDenyReason,
  type PageCapError,
} from "../../shared/page-capabilities";
import { capFailure, fromPageFrame, PAGE_FRAME_ORIGIN } from "../page-reader/capabilities";

/** Same pause as the page card: a card ignores the click that landed as it appeared. */
const CARD_GUARD_MS = 600;

export interface AppCapCard {
  id: number;
  name: string;
  label: string;
  at: number;
  by: "org" | "person" | "page";
  always: boolean;
}

export type AppApprovalChoice = "once" | "always" | "decline";

export interface AppConnectorBrokerDeps {
  frame(): Window | null;
  /** The viewer's session. Throws with status and body, like the app's api. */
  api<T>(path: string, init?: { method: "POST"; body?: unknown }): Promise<T>;
  botId: string;
  threadId: string;
  messageId: string;
  caps: PageCapabilities;
  lang: "fr" | "en";
  signedIn: boolean;
  now?(): number;
}

export interface AppConnectorBroker {
  start(): void;
  onMessage(event: { source: unknown; origin: string; data: unknown; userActivation?: { isActive?: boolean } | null }): Promise<boolean>;
  resolveApproval(id: number, choice: AppApprovalChoice): boolean;
  getCards(): readonly AppCapCard[];
  subscribe(listener: () => void): () => void;
}

export function createAppConnectorBroker(deps: AppConnectorBrokerDeps): AppConnectorBroker {
  const now = () => deps.now?.() ?? Date.now();
  const listeners = new Set<() => void>();
  let cards: AppCapCard[] = [];
  const setCards = (next: AppCapCard[]) => {
    cards = next;
    for (const listener of listeners) listener();
  };
  let seq = 0;
  const approvals = new Map<number, (choice: AppApprovalChoice) => void>();
  const asking = new Map<string, Promise<AppApprovalChoice>>();

  const post = (message: Record<string, unknown>) => {
    deps.frame()?.postMessage({ v: 1, ...message }, "*");
  };
  const answer = (id: number, outcome: { ok: true; value: unknown } | { ok: false; error: PageCapError; message?: string; reason?: PageCapDenyReason }) => {
    post({ type: CAP_RESULT_MESSAGE, id, ...outcome });
  };
  const base = `/api/bots/${encodeURIComponent(deps.botId)}/apps/${encodeURIComponent(deps.messageId)}`;

  const askFirst = (name: string, label: string, how: Pick<AppCapCard, "by" | "always">): Promise<AppApprovalChoice> => {
    const open = asking.get(name);
    if (open) return open;
    const id = ++seq;
    const pending = new Promise<AppApprovalChoice>((resolve) => {
      approvals.set(id, (choice) => {
        approvals.delete(id);
        asking.delete(name);
        setCards(cards.filter((entry) => entry.id !== id));
        resolve(choice);
      });
    });
    asking.set(name, pending);
    setCards([...cards, { id, name, label, at: now(), ...how }]);
    return pending;
  };

  const callConnector = async (call: { connector: string; tool: string; arguments: unknown; click: boolean }, asked = false): Promise<unknown> => {
    try {
      return await deps.api(`${base}/connector?lang=${deps.lang}`, { method: "POST", body: { threadId: deps.threadId, ...call } });
    } catch (cause) {
      const failure = capFailure(cause);
      const said = (cause as { body?: { approvalId?: unknown; label?: unknown; by?: unknown; always?: unknown } }).body;
      const approvalId = said?.approvalId;
      if (failure.error !== "ask_first" || asked || typeof approvalId !== "string") throw cause;
      const by = said?.by === "person" || said?.by === "page" ? said.by : "org";
      const label = typeof said?.label === "string" ? said.label.slice(0, 160) : `${call.connector}: ${call.tool}`;
      const choice = await askFirst(`connector:${call.connector}/${call.tool}`, label, { by, always: said?.always !== false });
      await deps.api(`${base}/approvals/${encodeURIComponent(approvalId)}?lang=${deps.lang}`, { method: "POST", body: { threadId: deps.threadId, answer: choice === "decline" ? "deny" : choice } });
      if (choice === "decline") {
        throw Object.assign(new Error(deps.lang === "fr" ? "Tu as refusé cette demande." : "You declined this request."), { code: "denied", reason: "declined", status: 403 });
      }
      return callConnector(call, true);
    }
  };

  return {
    start() {
      post({ type: CAP_READY_MESSAGE, taken: true });
    },
    async onMessage(event) {
      if (!fromPageFrame(event, deps.frame(), PAGE_FRAME_ORIGIN)) return false;
      if (event.data && typeof event.data === "object" && (event.data as { type?: unknown; v?: unknown }).type === CAP_HELLO_MESSAGE && (event.data as { v?: unknown }).v === 1) {
        post({ type: CAP_READY_MESSAGE, taken: true });
        return true;
      }
      const request = parsePageCapRequest(event.data);
      if (!request) {
        const unknown = pageCapCallId(event.data);
        if (unknown === null) return false;
        answer(unknown, { ok: false, error: "unavailable", message: deps.lang === "fr" ? "Cette app ne peut pas encore faire ça." : "This app cannot do this yet." });
        return true;
      }
      const id = request.id;
      post({ type: CAP_TAKEN_MESSAGE, id });
      if (!deps.signedIn) {
        answer(id, { ok: false, error: "sign_in", message: deps.lang === "fr" ? "Connecte-toi pour utiliser cette app." : "Sign in to use this app." });
        return true;
      }
      // user activation only. The frame can set gesture on a load.
      const fromClick = event.userActivation?.isActive === true;
      if (request.cap !== "connector.call") {
        const source = request.cap === "data.read" ? request.args?.name : request.args?.collection;
        const granted = pageCapGranted(deps.caps, request.cap, typeof source === "string" ? source : undefined);
        answer(id, granted
          ? { ok: false, error: "unavailable", message: deps.lang === "fr" ? "Cette app ne peut pas encore faire ça." : "This app cannot do this yet." }
          : { ok: false, error: "not_declared", message: deps.lang === "fr" ? "Cette app ne déclare pas cette capacité." : "This app does not declare this capability." });
        return true;
      }
      const connector = request.args?.connector;
      const tool = request.args?.tool;
      if (typeof connector !== "string" || typeof tool !== "string") {
        answer(id, { ok: false, error: "bad_request", message: "A connector and a tool are needed." });
        return true;
      }
      if (!pageCapGranted(deps.caps, "connector.call", connector, tool)) {
        answer(id, { ok: false, error: "not_declared", message: `This app does not declare ${connector} ${tool}.` });
        return true;
      }
      try {
        const value = await callConnector({
          connector,
          tool,
          arguments: request.args?.arguments && typeof request.args.arguments === "object" ? request.args.arguments : {},
          click: fromClick,
        });
        answer(id, { ok: true, value });
      } catch (cause) {
        answer(id, { ok: false, ...capFailure(cause) });
      }
      return true;
    },
    resolveApproval(id, choice) {
      const entry = cards.find((card) => card.id === id);
      if (!entry || (choice !== "decline" && now() - entry.at < CARD_GUARD_MS)) return false;
      approvals.get(id)?.(choice);
      return true;
    },
    getCards: () => cards,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A sagax-cap message this broker would ignore: not from the frame, or not from its opaque origin. */
export function appCapMessageIgnored(event: { source: unknown; origin: string }, frame: Window | null): boolean {
  return !fromPageFrame(event, frame, PAGE_FRAME_ORIGIN);
}
