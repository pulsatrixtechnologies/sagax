// Microsoft Graph change notification subscriptions for typed triggers
// (Microsoft Teams, Outlook mail, Outlook Calendar). When the owner picks a
// signed-in Microsoft connector (a remote MCP server whose Microsoft sign-in
// holds a Graph scope the source needs), Sagax creates the subscription
// pointing at the trigger's `/sources/<endpointId>` URL with the trigger's
// secret as `clientState`, renews it before it ends, remakes it when the
// secret, resource or connector changes, and deletes it when the trigger is
// paused or deleted. Without such a connector the setup steps stay manual.
//
// Rules: the access token and the clientState go to Graph only, never into
// a status, a log or a frame; Graph's error text is never kept (a fixed code
// is); a failure never blocks the trigger edit that caused it.
import { createHash } from "node:crypto";

import {
  GRAPH_SUBSCRIPTION_SCOPES,
  type GraphConnectorOption,
  type TriggerAutomationStatus,
  type TriggerSourceType,
} from "../shared/trigger-sources.ts";
import type { AutomationPatch, AutomationTarget } from "./triggers/webhooks.ts";

export const GRAPH_API = "https://graph.microsoft.com/v1.0";
const MICROSOFT_ISSUER_HOSTS = new Set(["login.microsoftonline.com", "login.microsoft.com", "login.windows.net", "sts.windows.net", "login.microsoftonline.us", "login.partner.microsoftonline.cn"]);
const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

/** Lifetimes Sagax asks for (Graph caps mail and events at 10,080
 * minutes, Teams messages at 4,320). */
const LIFETIME_MINUTES: Partial<Record<TriggerSourceType, number>> = { email: 8_640, calendar: 8_640, teams: 4_200 };
/** Renew when less than this is left. */
export const RENEW_MARGIN_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const DEFAULT_RESOURCE: Partial<Record<TriggerSourceType, string>> = {
  email: "me/mailFolders('Inbox')/messages",
  calendar: "me/events",
};
const CHANGE_TYPES: Partial<Record<TriggerSourceType, string>> = {
  email: "created",
  calendar: "created,updated,deleted",
  teams: "created,updated",
};

/** One signed-in account of a remote MCP server, as the token store has it. */
export interface GraphSignIn {
  connector: string;
  account: string;
  label?: string;
  issuer: string;
  /** Scopes the sign-in was granted (space separated in the token reply). */
  scopes: string[];
}

export interface GraphTokenSource {
  signIns(): GraphSignIn[];
  /** A usable access token (refreshed when due), or null. */
  accessToken(connector: string, account: string): Promise<string | null>;
}

export function isMicrosoftIssuer(issuer: string): boolean {
  try {
    return MICROSOFT_ISSUER_HOSTS.has(new URL(issuer).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function scopeName(scope: string): string {
  const lower = scope.trim().toLowerCase();
  return lower.startsWith(GRAPH_SCOPE_PREFIX) ? lower.slice(GRAPH_SCOPE_PREFIX.length) : lower;
}

/** Graph sources a sign-in can subscribe for. */
export function graphSourcesFor(signIn: GraphSignIn): TriggerSourceType[] {
  if (!isMicrosoftIssuer(signIn.issuer)) return [];
  const granted = new Set(signIn.scopes.map(scopeName));
  return (Object.entries(GRAPH_SUBSCRIPTION_SCOPES) as Array<[TriggerSourceType, readonly string[]]>)
    .filter(([, needed]) => needed.some((scope) => granted.has(scope.toLowerCase())))
    .map(([type]) => type);
}

/** The connectors the editor offers, with the sources each one covers. */
export function graphConnectorOptions(tokens: GraphTokenSource): GraphConnectorOption[] {
  const out: GraphConnectorOption[] = [];
  for (const signIn of tokens.signIns()) {
    if (!isMicrosoftIssuer(signIn.issuer)) continue;
    out.push({ connector: signIn.connector, account: signIn.account, ...(signIn.label ? { label: signIn.label } : {}), sources: graphSourcesFor(signIn) });
  }
  return out;
}

export function graphResourceFor(type: TriggerSourceType, resource: string | undefined): string | undefined {
  return resource || DEFAULT_RESOURCE[type];
}

export function clientStateHash(clientState: string): string {
  return createHash("sha256").update(clientState).digest("hex").slice(0, 16);
}

export interface GraphSubscriptionHost {
  automationTargets(): AutomationTarget[];
  automationTargetFor(id: string): AutomationTarget | null;
  setAutomation(id: string, patch: AutomationPatch): boolean;
}

export interface GraphSubscriptionOptions {
  webhooks: GraphSubscriptionHost;
  tokens: GraphTokenSource;
  /** The webhook listener's public base URL (must be https for Graph). */
  baseUrl: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  graphApi?: string;
}

type Outcome = { ok: true; id: string; expiresAt: number } | { ok: false; code: string; gone?: boolean };

export class GraphSubscriptions {
  private readonly options: GraphSubscriptionOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly api: string;
  /** One reconcile per trigger at a time; a second request waits for it,
   *  then runs once more. */
  private readonly running = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();

  constructor(options: GraphSubscriptionOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.api = (options.graphApi ?? GRAPH_API).replace(/\/$/, "");
  }

  /** Bring every trigger's subscription up to date (create, renew, remove). */
  async reconcileAll(): Promise<void> {
    for (const target of this.options.webhooks.automationTargets()) {
      if (target.source.graph || target.graphSubscription) await this.reconcile(target.id);
    }
  }

  reconcile(id: string): Promise<void> {
    const current = this.running.get(id);
    if (current) {
      this.again.add(id);
      return current;
    }
    const work = (async () => {
      do {
        this.again.delete(id);
        await this.reconcileOnce(id).catch(() => undefined);
      } while (this.again.has(id));
    })().finally(() => this.running.delete(id));
    this.running.set(id, work);
    return work;
  }

  /** The trigger is gone: delete its subscription at Microsoft. */
  async removed(target: AutomationTarget): Promise<void> {
    if (target.graphSubscription) await this.deleteRemote(target.graphSubscription).catch(() => undefined);
  }

  private status(id: string, status: Omit<TriggerAutomationStatus, "kind" | "at">, extra: AutomationPatch = {}): void {
    this.options.webhooks.setAutomation(id, { ...extra, automation: { kind: "graph", at: this.now(), ...status } });
  }

  private async reconcileOnce(id: string): Promise<void> {
    const target = this.options.webhooks.automationTargetFor(id);
    if (!target) return;
    const graph = target.source.graph;
    const existing = target.graphSubscription;
    const wanted = Boolean(graph && (target.enabled || target.verificationPending) && target.clientState);
    if (!graph || !wanted) {
      if (existing) await this.deleteRemote(existing).catch(() => undefined);
      if (existing || target.source.graph) {
        this.options.webhooks.setAutomation(id, graph ? { graphSubscription: null, automation: { kind: "graph", state: "pending", code: "paused", at: this.now() } } : { graphSubscription: null, automation: null });
      }
      return;
    }
    const resource = graphResourceFor(target.source.type, graph.resource);
    if (!resource) return this.status(id, { state: "error", code: "needs-resource" });
    const base = this.options.baseUrl();
    if (!base || !/^https:\/\//i.test(base)) return this.status(id, { state: "error", code: "needs-https" });
    const account = graph.account ?? "default";
    const signIn = this.options.tokens.signIns().find((entry) => entry.connector === graph.connector && entry.account === account);
    if (!signIn || !isMicrosoftIssuer(signIn.issuer)) return this.status(id, { state: "error", code: "no-connector" });
    if (!graphSourcesFor(signIn).includes(target.source.type)) return this.status(id, { state: "error", code: "no-scope" });
    const hash = clientStateHash(target.clientState!);
    let current = existing;
    if (current && (current.resource !== resource || current.connector !== graph.connector || (current.account ?? "default") !== account || current.clientStateHash !== hash)) {
      await this.deleteRemote(current).catch(() => undefined);
      this.options.webhooks.setAutomation(id, { graphSubscription: null });
      current = undefined;
    }
    if (current && current.expiresAt - this.now() > RENEW_MARGIN_MS) {
      return this.status(id, { state: "ok", code: "active", expiresAt: current.expiresAt });
    }
    const token = await this.options.tokens.accessToken(graph.connector, account).catch(() => null);
    if (!token) return this.status(id, { state: "error", code: "signed-out" });
    const expiration = new Date(this.now() + (LIFETIME_MINUTES[target.source.type] ?? 4_200) * 60_000).toISOString();
    if (current) {
      const renewed = await this.request(token, "PATCH", `/subscriptions/${encodeURIComponent(current.id)}`, { expirationDateTime: expiration });
      if (renewed.ok) {
        this.status(id, { state: "ok", code: "renewed", expiresAt: renewed.expiresAt }, { graphSubscription: { ...current, expiresAt: renewed.expiresAt } });
        return;
      }
      if (!renewed.gone) return this.status(id, { state: "error", code: renewed.code, expiresAt: current.expiresAt });
      // Gone at Microsoft (expired or removed): make a new one.
      this.options.webhooks.setAutomation(id, { graphSubscription: null });
    }
    const url = `${base.replace(/\/$/, "")}/sources/${target.endpointId}`;
    const created = await this.request(token, "POST", "/subscriptions", {
      changeType: CHANGE_TYPES[target.source.type],
      notificationUrl: url,
      lifecycleNotificationUrl: url,
      resource,
      expirationDateTime: expiration,
      clientState: target.clientState,
      latestSupportedTlsVersion: "v1_2",
    });
    if (!created.ok) return this.status(id, { state: "error", code: created.code });
    this.status(id, { state: "ok", code: "created", expiresAt: created.expiresAt }, {
      graphSubscription: { id: created.id, resource, connector: graph.connector, ...(account !== "default" ? { account } : {}), expiresAt: created.expiresAt, clientStateHash: hash },
    });
  }

  private async deleteRemote(subscription: NonNullable<AutomationTarget["graphSubscription"]>): Promise<void> {
    const token = await this.options.tokens.accessToken(subscription.connector, subscription.account ?? "default").catch(() => null);
    if (!token) return;
    await this.request(token, "DELETE", `/subscriptions/${encodeURIComponent(subscription.id)}`);
  }

  private async request(token: string, method: string, path: string, body?: Record<string, unknown>): Promise<Outcome> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}), accept: "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "network" };
    }
    if (method === "DELETE") return response.ok || response.status === 404 ? { ok: true, id: "", expiresAt: 0 } : { ok: false, code: "refused" };
    if (response.status === 404) return { ok: false, code: "gone", gone: true };
    if (response.status === 401 || response.status === 403) return { ok: false, code: "forbidden" };
    if (!response.ok) return { ok: false, code: response.status === 400 ? "refused" : "graph-error" };
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, code: "graph-error" };
    }
    const record = data && typeof data === "object" ? data as { id?: unknown; expirationDateTime?: unknown } : {};
    const expiresAt = typeof record.expirationDateTime === "string" ? Date.parse(record.expirationDateTime) : NaN;
    if (!Number.isFinite(expiresAt)) return { ok: false, code: "graph-error" };
    const subscriptionId = method === "POST" ? record.id : path.split("/").pop();
    if (typeof subscriptionId !== "string" || !subscriptionId) return { ok: false, code: "graph-error" };
    return { ok: true, id: decodeURIComponent(subscriptionId), expiresAt };
  }
}
