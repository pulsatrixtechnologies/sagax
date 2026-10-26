/** Typed trigger sources: the catalog both the server (verification,
 * normalization, filters) and the app (TriggersPanel) read. Pure data, no
 * secrets. A typed trigger is a webhook whose sender is a known provider: it
 * is authenticated by that provider's own signature scheme on its own path
 * (`/sources/<endpointId>`), its events are normalized to one shape, filtered
 * and deduplicated before a run is queued, and the event reaches the routine
 * as fenced, untrusted data. See server/trigger-sources.ts. */

export const TRIGGER_SOURCE_TYPES = [
  "github",
  "gitlab",
  "slack",
  "teams",
  "email",
  "calendar",
  "sentry",
  "pagerduty",
  "linear",
  "botmail",
] as const;

export type TriggerSourceType = (typeof TRIGGER_SOURCE_TYPES)[number];

/** Fields a filter can test. `keyword` tests the event's title and text
 * (case-insensitive substring); every other key is an exact or `*` glob match
 * on the normalized field of the same name, case-insensitive. */
export const TRIGGER_FILTER_KEYS = [
  "repo",
  "branch",
  "label",
  "sender",
  "reviewer",
  "assignee",
  "status",
  "channel",
  "reaction",
  "team",
  "subject",
  "organizer",
  "series",
  "project",
  "environment",
  "level",
  "service",
  "urgency",
  "keyword",
] as const;

export type TriggerFilterKey = (typeof TRIGGER_FILTER_KEYS)[number];

/** How the provider proves who it is.
 * - `generated`: Sagax makes the secret, shown once, pasted into the provider.
 * - `provided`: the provider makes it; the owner pastes it into Sagax.
 * - `relay`: no secret and no endpoint at all. Events arrive only through a
 *   Sagax route with its own credential (bot email: the Perspicax relay's
 *   console assertion on `POST /api/org/inbound-mail`), never on
 *   `/sources/<endpointId>`. */
export type TriggerSecretMode = "generated" | "provided" | "relay";

export interface TriggerSourceDefinition {
  type: TriggerSourceType;
  /** Brand name, never translated. */
  label: string;
  secretMode: TriggerSecretMode;
  /** Normalized event kinds this source emits, in the order shown. */
  events: readonly string[];
  filters: readonly TriggerFilterKey[];
  /** A finer kind and the broader kind it refines. A trigger that picked
   * the broader one (made before the finer one existed) still runs for it:
   * an approval is still a submitted review. */
  parents?: Readonly<Record<string, string>>;
  /** The events of catalog 1. A trigger saved before catalog 2 with no
   * event checked (“every event”) keeps meaning this set, so it does not
   * start running for every comment or push it never asked for. */
  legacyEvents?: readonly string[];
  /** Some providers (Microsoft Graph basic notifications) send no detail
   * at reception: filters on these keys are handed to the run as the
   * owner's conditions, checked by the bot before it acts. */
  deferredFilters?: readonly TriggerFilterKey[];
  /** The source also accepts events pushed by a connector poller
   * (`WebhookManager.ingest`), e.g. calendar start times. */
  connectorEvents?: readonly string[];
  /** Filters on these keys match when the field CONTAINS a value
   * (case-insensitive) instead of the exact or `*` glob rule. */
  containsFilters?: readonly TriggerFilterKey[];
  /** Word of the run's fence (`[UNTRUSTED <fence> EVENT DATA ...]`) when
   * the label is not one (two words, translated in the app). */
  fence?: string;
  /** Window, in seconds, a signed timestamp may differ from now. Absent
   * when the provider signs none (replay is then stopped by the delivery id
   * the deduplication keeps). */
  replayWindowSeconds?: number;
}

export const TRIGGER_SOURCES: Record<TriggerSourceType, TriggerSourceDefinition> = {
  github: {
    type: "github",
    label: "GitHub",
    secretMode: "generated",
    events: [
      "pr.opened", "pr.updated", "pr.merged", "pr.closed",
      "pr.review_requested", "pr.review_submitted", "pr.review_approved", "pr.review_changes_requested", "pr.review_commented",
      "pr.comment", "pr.review_comment", "pr.thread_resolved", "pr.thread_reopened",
      "ci.failed", "ci.succeeded", "issue.opened", "issue.assigned", "push", "release.published",
    ],
    filters: ["repo", "branch", "label", "sender", "reviewer", "assignee", "keyword"],
    legacyEvents: ["pr.opened", "pr.merged", "pr.closed", "pr.review_requested", "pr.review_submitted", "ci.failed", "ci.succeeded", "issue.opened", "push", "release.published"],
    parents: {
      "pr.review_approved": "pr.review_submitted",
      "pr.review_changes_requested": "pr.review_submitted",
      "pr.review_commented": "pr.review_submitted",
    },
  },
  gitlab: {
    type: "gitlab",
    label: "GitLab",
    secretMode: "generated",
    events: ["mr.opened", "mr.merged", "mr.closed", "pipeline.failed", "pipeline.succeeded", "issue.opened", "push"],
    filters: ["repo", "branch", "label", "sender", "keyword"],
  },
  slack: {
    type: "slack",
    label: "Slack",
    secretMode: "provided",
    events: ["mention", "reaction", "message"],
    filters: ["channel", "sender", "reaction", "keyword"],
    replayWindowSeconds: 300,
  },
  teams: {
    type: "teams",
    label: "Microsoft Teams",
    secretMode: "generated",
    events: ["message.created", "message.updated"],
    filters: ["team", "channel", "sender", "keyword"],
    deferredFilters: ["sender", "keyword"],
  },
  email: {
    type: "email",
    label: "Outlook",
    secretMode: "generated",
    events: ["email.received"],
    filters: ["sender", "subject", "keyword"],
    deferredFilters: ["sender", "subject", "keyword"],
    connectorEvents: ["email.received"],
  },
  calendar: {
    type: "calendar",
    label: "Outlook Calendar",
    secretMode: "generated",
    events: ["event.created", "event.updated", "event.cancelled", "event.starting"],
    filters: ["subject", "organizer", "series", "keyword"],
    deferredFilters: ["subject", "organizer", "series", "keyword"],
    connectorEvents: ["event.starting"],
  },
  sentry: {
    type: "sentry",
    label: "Sentry",
    secretMode: "provided",
    events: ["issue.created", "issue.resolved", "issue.assigned", "issue.archived", "issue.unresolved", "alert.triggered", "error.created"],
    filters: ["project", "environment", "level", "assignee", "keyword"],
    legacyEvents: ["issue.created", "issue.resolved", "issue.assigned", "alert.triggered", "error.created"],
    replayWindowSeconds: 300,
  },
  pagerduty: {
    type: "pagerduty",
    label: "PagerDuty",
    secretMode: "provided",
    events: ["incident.triggered", "incident.acknowledged", "incident.escalated", "incident.reassigned", "incident.resolved"],
    filters: ["service", "urgency", "team", "keyword"],
  },
  linear: {
    type: "linear",
    label: "Linear",
    secretMode: "provided",
    events: ["issue.created", "issue.updated", "issue.status_changed", "issue.removed", "comment.created", "cycle.completed"],
    filters: ["team", "project", "label", "status", "assignee", "sender", "keyword"],
    parents: { "issue.status_changed": "issue.updated" },
    legacyEvents: ["issue.created", "issue.updated", "issue.removed", "comment.created"],
    replayWindowSeconds: 60,
  },
  // 2026-10-21 (B21 / iOS CO5): mail sent to the bot's own address,
  // `<name>@<inbound domain>`, received by Perspicax and relayed to this
  // server (server/bot-inbound-mail.ts). It only wakes a routine; replies go
  // through a mail connector's send tool and its approval card.
  botmail: {
    type: "botmail",
    label: "Bot email",
    secretMode: "relay",
    events: ["email.received"],
    filters: ["sender", "subject", "keyword"],
    containsFilters: ["subject"],
    fence: "BOTMAIL",
  },
};

/** Version of the event catalog a trigger was saved against. 2 added the
 * GitHub comments, reviews and threads, Linear status and cycles, Sentry
 * archived and unresolved. */
export const TRIGGER_CATALOG_VERSION = 2;

/** The kinds “every event” means for a trigger saved against `catalog`
 * (absent: before versions existed, so 1). */
export function triggerEveryEvent(type: TriggerSourceType, catalog: number | undefined): readonly string[] {
  const definition = TRIGGER_SOURCES[type];
  return (catalog ?? 1) < TRIGGER_CATALOG_VERSION && definition.legacyEvents ? definition.legacyEvents : definition.events;
}

/** Whether a trigger that picked `selected` (empty: every kind of its
 * catalog) runs for an event of `kind`, its broader kind included. */
export function triggerEventSelected(type: TriggerSourceType, selected: readonly string[], kind: string, catalog?: number): boolean {
  const pool = selected.length ? selected : triggerEveryEvent(type, catalog);
  if (pool.includes(kind)) return true;
  const parents = TRIGGER_SOURCES[type].parents;
  return parents !== undefined && Object.hasOwn(parents, kind) && pool.includes(parents[kind]!);
}

/** A source whose events come only through its own Sagax route (no secret,
 * no `/sources/<endpointId>` endpoint). */
export function isRelaySource(type: TriggerSourceType): boolean {
  return TRIGGER_SOURCES[type].secretMode === "relay";
}

export function isTriggerSourceType(value: unknown): value is TriggerSourceType {
  return typeof value === "string" && (TRIGGER_SOURCE_TYPES as readonly string[]).includes(value);
}

/** What a typed trigger stores besides the plain webhook fields. */
export interface TriggerSourceConfig {
  type: TriggerSourceType;
  /** Normalized kinds to start a run for; empty means every kind. */
  events: string[];
  /** Each key with values must match at least one of them. */
  filters: Partial<Record<TriggerFilterKey, string[]>>;
  /** Event catalog the trigger was saved against (TRIGGER_CATALOG_VERSION);
   * absent on a trigger saved before versions existed. */
  catalog?: number;
  /** GitHub: also run for PR and inline review comments posted by a GitHub
   * app or bot. Off by default so a bot never triggers itself. */
  includeBotComments?: boolean;
  /** Bot email (2026-10-21, S2): a mail-woken run is confined (no shell,
   * a card for every write or outbound call, no Always-allow or Full) unless
   * the owner turns this on for the trigger. Off by default. */
  allowFullTools?: boolean;
  /** Deliveries accepted per minute before 429 (1 to 120, default 10). */
  rateLimitPerMinute?: number;
  /** Microsoft Graph: only notifications from this tenant are accepted. */
  tenantId?: string;
  /** Microsoft Graph: Sagax creates and renews the change notification
   * subscription itself through this signed-in connector (an MCP server
   * whose Microsoft sign-in holds the scope the source needs). Absent: the
   * owner creates the subscription by hand (setup steps). */
  graph?: TriggerGraphConfig;
  /** Outlook mail or calendar without Graph: a poller reads the mailbox
   * (IMAP) or the calendar (ICS link, CalDAV) and feeds the trigger. The
   * password or the private ICS link is write only and stored apart. */
  poller?: TriggerPollerConfig;
}

export interface TriggerGraphConfig {
  /** Name of the MCP server whose Microsoft sign-in is used. */
  connector: string;
  /** Account of that server; absent is its first account. */
  account?: string;
  /** Graph resource to watch. Mail and calendar have a default; Teams needs
   * `teams/<team id>/channels/<channel id>/messages` (or a chat). */
  resource?: string;
}

export const TRIGGER_POLLER_KINDS = ["imap", "ics", "caldav"] as const;
export type TriggerPollerKind = (typeof TRIGGER_POLLER_KINDS)[number];

export interface TriggerPollerConfig {
  kind: TriggerPollerKind;
  /** IMAP server host name (TLS on `port`, 993 by default). */
  host?: string;
  port?: number;
  /** IMAP mailbox, INBOX by default. */
  mailbox?: string;
  /** IMAP or CalDAV user name. Not exported with a bot. */
  username?: string;
  /** CalDAV calendar collection URL (https). An ICS link is a credential:
   * it is never here, only in the poller's credential store. */
  url?: string;
  /** Minutes between two reads (1 to 60, default 5). */
  intervalMinutes?: number;
  /** Calendar: minutes before the start `event.starting` fires (0 to 1440,
   * default 10). */
  leadMinutes?: number;
}

export const POLLER_INTERVAL_DEFAULT = 5;
export const POLLER_INTERVAL_MAX = 60;
export const POLLER_LEAD_DEFAULT = 10;
export const POLLER_LEAD_MAX = 1_440;

/** Which poller kinds a source takes. */
export const POLLER_KINDS_FOR: Partial<Record<TriggerSourceType, readonly TriggerPollerKind[]>> = {
  email: ["imap"],
  calendar: ["ics", "caldav"],
};

/** Graph scopes (any one is enough) Sagax needs to create the
 * subscription for a source; Graph sources only. */
export const GRAPH_SUBSCRIPTION_SCOPES: Partial<Record<TriggerSourceType, readonly string[]>> = {
  email: ["Mail.Read", "Mail.ReadBasic", "Mail.ReadWrite", "Mail.ReadBasic.All", "Mail.Read.All"],
  calendar: ["Calendars.Read", "Calendars.ReadWrite", "Calendars.ReadBasic"],
  teams: ["ChannelMessage.Read.All", "Chat.Read", "Chat.ReadWrite", "ChannelMessage.Read.Group"],
};

/** A signed-in Microsoft connector the trigger editor can offer. */
export interface GraphConnectorOption {
  connector: string;
  account: string;
  label?: string;
  /** Graph sources this sign-in has a scope for. */
  sources: TriggerSourceType[];
}

/** Server-kept automation state of a typed trigger (no secret). */
export interface TriggerAutomationStatus {
  kind: "graph" | "poller";
  state: "ok" | "error" | "pending";
  /** Fixed, translated-by-code reason; never a provider's own text. */
  code?: string;
  at: number;
  /** Graph: when the current subscription ends. */
  expiresAt?: number;
}

export const TRIGGER_RATE_LIMIT_DEFAULT = 10;
export const TRIGGER_RATE_LIMIT_MAX = 120;

/** One event, as every source hands it to filters and to the run. */
export interface NormalizedTriggerEvent {
  source: TriggerSourceType;
  kind: string;
  title: string;
  url?: string;
  occurredAt?: string;
  /** Filterable fields, by filter key (`label` may hold several). */
  fields: Partial<Record<Exclude<TriggerFilterKey, "keyword">, string | string[]>>;
  /** Free text the keyword filter also reads (message text, description). */
  text?: string;
  /** Provider resource path or id the bot can fetch through its connector. */
  resource?: string;
  /** A comment posted by an app or bot account (GitHub `type: "Bot"`). */
  fromBot?: boolean;
}

/** Shown once after create (or rotate of a generated secret): where the
 * provider sends events, and the secret when Sagax generated it. */
export interface TriggerSourceSetup {
  endpointUrl: string;
  secret?: string;
}
