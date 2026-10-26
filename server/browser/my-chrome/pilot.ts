// My Chrome: what a bot's browser call may do in the person's own Chrome, and
// which calls wait on the person's approval card. Pure except runMyChromeTool,
// which takes everything it touches as dependencies (server/index.ts wires the
// browser runtime, the gate and the approval card).
//
// Rules (JC, 2026-10-19):
// - only the tools that drive a page; no script of the bot's own (eval), no
//   cookies or saved state, no reading an address around the browser, and
//   elements only by their @eN refs from a snapshot (so each click can be
//   named on a card);
// - a payment or purchase, a send (form, email, message, post) or a delete
//   waits on an approval card. Detection is by the element's role and name
//   from the bot's last snapshot, the key pressed, the text typed and the
//   address opened; when the call cannot be named (an unknown ref, a button
//   with no name, Enter outside a search box) it is a card too.

export const MY_CHROME_PROFILE = "my-chrome";

/** Added to the browser prompt for a bot set to My Chrome. */
export const MY_CHROME_SYSTEM_PROMPT = " Your browser is the person's own Chrome (My Chrome), where they are signed in: it works only on the sites they allowed, in tabs you open (a banner shows them you drive it), and stops the moment they press Stop. There are no scripts, cookies or saved state there; address elements by their @eN refs. A payment or purchase, a send (a form, an email, a message, a post) or a delete waits on the person's approval card: say what you are about to do, and never try to get around a refusal.";

export type SensitiveKind = "payment" | "send" | "delete" | "unclear";

export interface SensitiveAction {
  kind: SensitiveKind;
  /** What the card says the bot is about to do, in plain words. */
  action: string;
}

export interface RefInfo { role: string; name: string }

/** Tools a bot may call in My Chrome. Everything else is refused. */
const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "agent_browser_open", "agent_browser_snapshot", "agent_browser_click", "agent_browser_fill", "agent_browser_type",
  "agent_browser_press", "agent_browser_check", "agent_browser_uncheck", "agent_browser_select", "agent_browser_scroll",
  "agent_browser_wait_ms", "agent_browser_wait_for_selector", "agent_browser_wait_for_text", "agent_browser_wait_for_load",
  "agent_browser_screenshot", "agent_browser_get_text", "agent_browser_get_url", "agent_browser_get_title",
  "agent_browser_back", "agent_browser_forward", "agent_browser_reload", "agent_browser_close",
  "agent_browser_tab_new", "agent_browser_tab_list", "agent_browser_tab_switch", "agent_browser_tab_close",
  "agent_browser_read",
  // harness-owned (server/browser-runtime.ts): the vault's fill and the restart
  "fill_credential", "restart_browser",
]);

const ELEMENT_ARGUMENTS = ["selector", "target", "ref", "element", "sel", "locator"];
const REF = /^@?(e\d{1,6})$/;

function args(params: unknown): Record<string, unknown> {
  const value = (params as { arguments?: unknown } | null)?.arguments;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function toolName(params: unknown): string {
  const name = (params as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

/** Why this call may not run in My Chrome, or null. */
export function myChromeToolRefusal(params: unknown): string | null {
  const name = toolName(params);
  if (!ALLOWED_TOOLS.has(name)) {
    return `${name || "This tool"} is not available in My Chrome (the person's own Chrome): no scripts, cookies or saved state there. Use snapshots, clicks, typing and get_text.`;
  }
  const call = args(params);
  if (name === "agent_browser_read" && call.url !== undefined && call.url !== "") {
    return "In My Chrome, open the address first, then read the page.";
  }
  if (name === "agent_browser_screenshot" && call.path !== undefined) {
    return "In My Chrome a screenshot comes back in the result, never to a file.";
  }
  if (name === "agent_browser_snapshot" || name === "agent_browser_get_text" || name === "agent_browser_wait_for_selector" || name === "agent_browser_scroll" || name === "agent_browser_screenshot") return null;
  for (const key of ELEMENT_ARGUMENTS) {
    const value = call[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !REF.test(value.trim())) {
      return "In My Chrome, elements are addressed only by their @eN refs from a snapshot, never by a CSS selector. Take a snapshot and pass the ref.";
    }
  }
  return null;
}

function refOf(params: unknown): string | null {
  const call = args(params);
  for (const key of ELEMENT_ARGUMENTS) {
    const value = call[key];
    if (typeof value === "string") {
      const match = REF.exec(value.trim());
      if (match) return match[1]!;
    }
  }
  return null;
}

function words(text: string): string {
  return ` ${text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const has = (text: string, list: readonly string[]) => list.some((word) => text.includes(` ${word} `));

// Matched on whole words, accents and case folded (words()).
const PAYMENT = [
  "pay", "pay now", "payer", "paiement", "payment", "buy", "buy now", "acheter", "achat", "purchase", "checkout", "check out",
  "place order", "order now", "commander", "passer la commande", "confirmer la commande", "subscribe", "s abonner", "abonner",
  "donate", "faire un don", "transfer", "virement", "transferer", "send money", "envoyer de l argent", "book now", "reserver",
  "upgrade", "add card", "ajouter une carte", "bid", "encherir", "rent", "louer", "paypal", "apple pay", "google pay", "tip", "pourboire",
];
const DELETE = [
  "delete", "supprimer", "suppression", "remove", "retirer", "erase", "effacer", "trash", "corbeille", "discard", "jeter",
  "destroy", "detruire", "unsubscribe", "desabonner", "se desabonner", "cancel subscription", "resilier", "close account",
  "fermer le compte", "deactivate", "desactiver", "revoke", "revoquer", "empty", "vider", "clear all", "tout effacer",
  "reset", "reinitialiser", "wipe",
];
const SEND = [
  "send", "envoyer", "submit", "soumettre", "post", "publier", "publish", "tweet", "reply", "repondre", "comment", "commenter",
  "share", "partager", "invite", "inviter", "sign", "signer", "apply", "postuler", "request", "message", "forward", "transferer",
  "save", "enregistrer", "sauvegarder", "update", "mettre a jour", "confirm", "confirmer", "valider", "validate", "ok", "yes", "oui",
  "accept", "accepter", "agree", "approve", "approuver", "done", "termine", "terminer", "finish", "continue", "continuer",
  "next", "suivant", "create", "creer", "add", "ajouter", "upload", "televerser", "join", "rejoindre",
];
// A sign-in button submits the person's own login (the vault filled it).
const SIGN_IN = ["sign in", "log in", "login", "se connecter", "connexion", "ouvrir une session", "s identifier"];

const BUTTONISH = new Set(["button", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "switch", "tab", "img", "image", "generic", "cell", "gridcell", "listitem", "treeitem"]);

/** The kind of a click on this element, or null when it is an ordinary one. */
export function sensitiveElement(ref: RefInfo | undefined): SensitiveKind | null {
  if (!ref) return "unclear";
  const name = words(ref.name);
  const role = ref.role.toLowerCase();
  if (has(name, DELETE)) return "delete";
  if (has(name, PAYMENT)) return "payment";
  if (role === "link") return has(name, ["send", "envoyer", "publish", "publier", "submit", "soumettre"]) ? "send" : null;
  if (["checkbox", "radio", "combobox", "textbox", "searchbox", "slider", "spinbutton", "heading", "paragraph", "statictext"].includes(role)) return null;
  if (has(name, SIGN_IN)) return null;
  if (has(name, SEND)) return "send";
  if (name.trim() === "" && (role === "button" || BUTTONISH.has(role))) return "unclear";
  return null;
}

/** An address that acts when opened (GET /delete?id=...). */
export function sensitiveAddress(raw: unknown): SensitiveKind | null {
  if (typeof raw !== "string" || !raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const text = words(`${url.pathname} ${url.search}`);
  if (has(text, ["delete", "remove", "destroy", "unsubscribe", "supprimer", "deactivate"])) return "delete";
  if (has(text, ["checkout", "pay", "payment", "purchase", "buy", "order", "paiement", "commande"])) return "payment";
  return null;
}

/** The refs a snapshot result named: agent-browser's JSON `data.refs` when
 * it is there (the page cannot write into it), else the snapshot text's
 * `- role "name" [ref=eN]` lines. A ref the text names twice, differently,
 * is dropped: page text that imitates a line cannot rename a real button
 * (a ref no longer known is carded as unclear). */
export function refsFromResult(result: unknown): Map<string, RefInfo> {
  const fromJson = new Map<string, RefInfo>();
  const fromText = new Map<string, RefInfo>();
  const conflicting = new Set<string>();
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return fromJson;
  for (const part of content) {
    const text = (part as { text?: unknown } | null)?.text;
    if (typeof text !== "string") continue;
    try {
      const parsed = JSON.parse(text) as { data?: { refs?: Record<string, { role?: unknown; name?: unknown }> } };
      for (const [ref, info] of Object.entries(parsed?.data?.refs ?? {})) {
        if (/^e\d+$/.test(ref)) fromJson.set(ref, { role: String(info?.role ?? ""), name: String(info?.name ?? "") });
      }
    } catch { /* text form below */ }
    for (const match of text.matchAll(/(?:^|\n|\\n)\s*-\s*([A-Za-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=(e\d+)\]/g)) {
      const info = { role: match[1]!, name: (match[2] ?? "").replace(/\\"/g, "\"") };
      const seen = fromText.get(match[3]!);
      if (seen && (seen.role !== info.role || seen.name !== info.name)) conflicting.add(match[3]!);
      else fromText.set(match[3]!, info);
    }
  }
  if (fromJson.size) return fromJson;
  for (const ref of conflicting) fromText.delete(ref);
  return fromText;
}

const KIND_WORDS: Record<SensitiveKind, string> = {
  payment: "a payment or purchase",
  send: "a send or submit",
  delete: "a delete",
  unclear: "an action Sagax cannot name",
};

/** Session memory: the refs of the last snapshot and the field typed in last. */
export class MyChromeMemory {
  private readonly refs = new Map<string, Map<string, RefInfo>>();
  private readonly lastTyped = new Map<string, RefInfo | undefined>();

  remember(session: string, params: unknown, result: unknown): void {
    const name = toolName(params);
    // Only a snapshot names refs, and it replaces the map: page text read by
    // get_text or a read result could imitate a ref line (security review
    // 2026-10-20), so no other result is parsed for refs.
    if (name === "agent_browser_snapshot") this.refs.set(session, refsFromResult(result));
    if (name === "agent_browser_fill" || name === "agent_browser_type") {
      const ref = refOf(params);
      this.lastTyped.set(session, ref ? this.refs.get(session)?.get(ref) : undefined);
    }
    if (name === "agent_browser_open" || name === "agent_browser_back" || name === "agent_browser_forward" || name === "agent_browser_reload" || name === "agent_browser_tab_switch" || name === "agent_browser_tab_new") {
      this.lastTyped.delete(session);
    }
  }

  forget(session: string): void {
    this.refs.delete(session);
    this.lastTyped.delete(session);
  }

  /** The card this call needs, or null when it may run as is. */
  classify(session: string, params: unknown): SensitiveAction | null {
    const name = toolName(params);
    const call = args(params);
    const refs = this.refs.get(session);
    const named = (ref: string | null) => {
      const info = ref ? refs?.get(ref) : undefined;
      return info ? `${info.role} "${info.name || "(no name)"}"` : `element ${ref ? `@${ref}` : "(unknown)"}`;
    };
    if (name === "agent_browser_click") {
      const ref = refOf(params);
      const kind = sensitiveElement(ref ? refs?.get(ref) : undefined);
      return kind ? { kind, action: `click ${named(ref)} (${KIND_WORDS[kind]})` } : null;
    }
    if (name === "agent_browser_press") {
      const combo = String(call.key ?? "").trim().toLowerCase();
      // The key a combination ends with: Control+Enter, Meta+Enter and
      // Shift+Enter send in mail and chat apps, so a modifier changes nothing.
      const key = combo === "+" || combo.endsWith("++") ? "+" : (combo.split("+").pop() ?? "").trim() || (combo.endsWith("+ ") ? " " : "");
      const modified = combo.includes("+") && key !== combo;
      if (!["enter", "return", "numpadenter", "space", " ", "spacebar"].includes(key)) return null;
      const typed = this.lastTyped.get(session);
      if (!modified && key !== "space" && key !== " " && key !== "spacebar" && typed && (typed.role === "searchbox" || has(words(typed.name), ["search", "rechercher", "recherche"]))) return null;
      return { kind: "send", action: `press ${String(call.key)} (it may submit a form)` };
    }
    if (name === "agent_browser_fill" || name === "agent_browser_type") {
      const text = typeof call.text === "string" ? call.text : "";
      if (/[\r\n]/.test(text)) return { kind: "send", action: `type text ending a line into ${named(refOf(params))} (it may submit a form)` };
      return null;
    }
    if (name === "agent_browser_open" || name === "agent_browser_tab_new") {
      const kind = sensitiveAddress(call.url);
      return kind ? { kind, action: `open ${String(call.url)} (${KIND_WORDS[kind]})` } : null;
    }
    return null;
  }
}

export interface MyChromeToolDeps {
  session: string;
  params: unknown;
  memory: MyChromeMemory;
  /** Run the call in the bot's browser (the runtime's agentRpc). */
  run(params: unknown): Promise<unknown>;
  /** The page the bot is on, for the card. */
  pageUrl(): Promise<string>;
  /** Open the approval card on the conversation and wait for the person.
   * allowKey, when given, lets the card offer "Always allow" (one kind of
   * action on one site) and is checked against the bot's grants first. */
  confirm(summary: string, allowKey?: string): Promise<"allow" | "deny" | "timeout">;
  /** What the gate refused since the last call (blocked navigations). */
  notes(): string[];
}

/** The "Always allow" grant of a sensitive action: one kind (payment, send,
 * delete) on one exact site. An unclear action, or a page with no web
 * origin, gets no grant: it is carded every time. */
export function myChromeAllowKey(kind: SensitiveKind, page: string): string | undefined {
  if (kind === "unclear") return undefined;
  let origin = "";
  try {
    const url = new URL(page);
    if (url.protocol === "https:" || url.protocol === "http:") origin = url.origin;
  } catch { /* no origin */ }
  return origin ? `my_chrome:${kind}:${origin}` : undefined;
}

function toolText(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true as const } : {}) };
}

/** One bot call in My Chrome: refused, carded, or run, with what the gate
 * blocked added to the result. */
export async function runMyChromeTool(deps: MyChromeToolDeps): Promise<unknown> {
  const refusal = myChromeToolRefusal(deps.params);
  if (refusal) return toolText(refusal, true);
  const sensitive = deps.memory.classify(deps.session, deps.params);
  if (sensitive) {
    let page = "";
    try { page = await deps.pageUrl(); } catch { /* the card still names the action */ }
    let origin = page;
    try { origin = new URL(page).origin; } catch { /* keep */ }
    const answer = await deps.confirm(`My Chrome: ${sensitive.action}${origin ? ` on ${origin}` : ""}`, myChromeAllowKey(sensitive.kind, page));
    if (answer !== "allow") {
      return toolText(`Not approved: the person did not approve this in My Chrome (${KIND_WORDS[sensitive.kind]}), so it did not happen. Do not retry it on your own; ask them, or continue without it.`, true);
    }
  }
  const result = await deps.run(deps.params);
  deps.memory.remember(deps.session, deps.params, result);
  const notes = deps.notes();
  if (!notes.length) return result;
  const body = result && typeof result === "object" ? result as { content?: unknown[] } : { content: [] };
  return { ...body, content: [...(Array.isArray(body.content) ? body.content : []), { type: "text", text: [...new Set(notes)].join("\n") }] };
}
