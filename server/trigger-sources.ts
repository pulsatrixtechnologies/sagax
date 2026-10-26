// Typed trigger sources: per-provider signature verification, handshakes,
// event normalization, filters and deduplication keys. Pure functions over
// a request's raw bytes and headers; the WebhookManager owns storage, rate
// limits and queueing, and webhook-ingress.ts owns the HTTP side.
//
// Every verifier works on the raw body exactly as received (never a
// re-serialized parse), compares in constant time, and rejects a signed
// timestamp outside the source's replay window. Every dedupe key comes from
// the signed body (a digest, or an id inside it), never an unsigned header,
// so a captured delivery replayed under a new header is still a duplicate.
// Sentry's timestamp header is not signed: its window is a sanity check, the
// body digest is what stops a replay.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  TRIGGER_SOURCES,
  triggerEventSelected,
  type NormalizedTriggerEvent,
  type TriggerFilterKey,
  type TriggerSourceConfig,
  type TriggerSourceType,
} from "../shared/trigger-sources.ts";
import type { JsonValue } from "./schema.ts";

export interface SourceRequest {
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  rawBody: string;
  query: URLSearchParams;
  /** Epoch milliseconds. */
  now: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string; replay?: boolean };

/** A reply the provider expects instead of 202 (URL checks). */
export interface SourceHandshake {
  status: number;
  contentType: string;
  body: string;
}

export interface SourceEvent {
  event: NormalizedTriggerEvent;
  /** Stable per provider delivery: the same event sent twice has the same key. */
  dedupeKey: string;
}

export type NormalizeResult = { events: SourceEvent[] } | { ignored: string };

const GRAPH_SOURCES = new Set<TriggerSourceType>(["teams", "email", "calendar"]);
const MAX_TEXT = 4_000;

export function isGraphSource(type: TriggerSourceType): boolean {
  return GRAPH_SOURCES.has(type);
}

// ── helpers ──────────────────────────────────────────────────────────────

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time string equality: both sides are hashed first so their
 * lengths always match and the comparison leaks nothing about either. */
export function safeEqual(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right) && actual.length === expected.length;
}

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function get(value: unknown, ...path: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function str(value: unknown, max = 300): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function names(value: unknown, field: string): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((entry) => str(get(entry, field), 120)).filter((entry): entry is string => Boolean(entry));
  return out.length ? out.slice(0, 30) : undefined;
}

/** Every identity of a person the provider sent (name, handle, email, id),
 * so a filter on any one of them matches. */
function identities(value: unknown, ...keys: string[]): string[] | undefined {
  const out = Array.from(new Set(keys.map((key) => str(get(value, key), 200)).filter((entry): entry is string => Boolean(entry))));
  return out.length ? out : undefined;
}

/** GitHub marks app and bot accounts `type: "Bot"`. */
function isBotAccount(...accounts: unknown[]): boolean {
  return accounts.some((account) => str(get(account, "type"))?.toLowerCase() === "bot");
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function event(
  source: TriggerSourceType,
  kind: string,
  title: string,
  fields: NormalizedTriggerEvent["fields"],
  extra: Partial<Pick<NormalizedTriggerEvent, "url" | "occurredAt" | "text" | "resource" | "fromBot">> = {},
): NormalizedTriggerEvent {
  return compact({
    source,
    kind,
    title: title.slice(0, 300),
    fields: compact(fields),
    url: extra.url,
    occurredAt: extra.occurredAt,
    text: extra.text?.slice(0, MAX_TEXT),
    resource: extra.resource,
    fromBot: extra.fromBot || undefined,
  });
}

function parseBody(raw: string): JsonValue | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return undefined;
  }
}

function withinWindow(seconds: number, now: number, windowSeconds: number): boolean {
  return Number.isFinite(seconds) && Math.abs(now / 1000 - seconds) <= windowSeconds;
}

// ── handshakes ───────────────────────────────────────────────────────────

/** Microsoft Graph checks a notification URL by POSTing `?validationToken=`
 * and expects the token back as text within 10 seconds. The request carries
 * no clientState, so this is answered for Graph sources only, before
 * authentication, and only echoes the token as plain text. */
export function handshakeBeforeAuth(type: TriggerSourceType, request: SourceRequest): SourceHandshake | null {
  if (!isGraphSource(type)) return null;
  const token = request.query.get("validationToken");
  if (token === null) return null;
  return { status: 200, contentType: "text/plain; charset=utf-8", body: token.slice(0, 1_024) };
}

/** Slack's `url_verification` is signed like any event: answered after the
 * signature passed. */
export function handshakeAfterAuth(type: TriggerSourceType, payload: JsonValue | undefined): SourceHandshake | null {
  if (type !== "slack" || get(payload, "type") !== "url_verification") return null;
  const challenge = str(get(payload, "challenge"), 200) ?? "";
  return { status: 200, contentType: "application/json", body: JSON.stringify({ challenge }) };
}

// ── signatures ───────────────────────────────────────────────────────────

export function verifySource(
  type: TriggerSourceType,
  request: SourceRequest,
  secret: string,
  config?: Pick<TriggerSourceConfig, "tenantId">,
): VerifyResult {
  // Bot email has no endpoint: it arrives only through the Perspicax relay's
  // own route (server/bot-inbound-mail.ts), whatever is presented here.
  if (TRIGGER_SOURCES[type].secretMode === "relay") return { ok: false, reason: "Bot email arrives only through the Perspicax relay" };
  if (!secret) return { ok: false, reason: "No signing secret is set for this trigger" };
  const { headers, rawBody, now } = request;
  const windowSeconds = TRIGGER_SOURCES[type].replayWindowSeconds ?? 300;
  switch (type) {
    case "github": {
      const signature = headers["x-hub-signature-256"] ?? "";
      if (!signature.startsWith("sha256=")) return { ok: false, reason: "Missing X-Hub-Signature-256" };
      return safeEqual(signature.slice(7).toLowerCase(), hmacHex(secret, rawBody))
        ? { ok: true }
        : { ok: false, reason: "Signature does not match" };
    }
    case "gitlab": {
      const token = headers["x-gitlab-token"] ?? "";
      if (!token) return { ok: false, reason: "Missing X-Gitlab-Token" };
      return safeEqual(token, secret) ? { ok: true } : { ok: false, reason: "Token does not match" };
    }
    case "slack": {
      const timestamp = headers["x-slack-request-timestamp"] ?? "";
      const signature = headers["x-slack-signature"] ?? "";
      if (!timestamp || !signature.startsWith("v0=")) return { ok: false, reason: "Missing Slack signature headers" };
      if (!/^\d{1,12}$/.test(timestamp) || !withinWindow(Number(timestamp), now, windowSeconds)) {
        return { ok: false, reason: "Timestamp outside the replay window", replay: true };
      }
      return safeEqual(signature.slice(3).toLowerCase(), hmacHex(secret, `v0:${timestamp}:${rawBody}`))
        ? { ok: true }
        : { ok: false, reason: "Signature does not match" };
    }
    case "teams":
    case "email":
    case "calendar": {
      const notifications = get(parseBody(rawBody), "value");
      if (!Array.isArray(notifications) || notifications.length === 0) return { ok: false, reason: "Not a Microsoft Graph notification" };
      for (const notification of notifications) {
        const clientState = str(get(notification, "clientState"), 256) ?? "";
        if (!safeEqual(clientState, secret)) return { ok: false, reason: "clientState does not match" };
        if (config?.tenantId) {
          const tenant = str(get(notification, "tenantId"), 100) ?? "";
          if (tenant.toLowerCase() !== config.tenantId.toLowerCase()) return { ok: false, reason: "Notification from another tenant" };
        }
      }
      return { ok: true };
    }
    case "sentry": {
      const signature = headers["sentry-hook-signature"] ?? "";
      const timestamp = headers["sentry-hook-timestamp"] ?? "";
      if (!signature) return { ok: false, reason: "Missing Sentry-Hook-Signature" };
      if (!timestamp || !withinWindow(Number(timestamp), now, windowSeconds)) {
        return { ok: false, reason: "Timestamp outside the replay window", replay: true };
      }
      return safeEqual(signature.toLowerCase(), hmacHex(secret, rawBody))
        ? { ok: true }
        : { ok: false, reason: "Signature does not match" };
    }
    case "pagerduty": {
      const header = headers["x-pagerduty-signature"] ?? "";
      const expected = hmacHex(secret, rawBody);
      // Several signatures while a secret rotates: any one may match.
      const candidates = header.split(",").map((part) => part.trim()).filter((part) => part.startsWith("v1="));
      if (!candidates.length) return { ok: false, reason: "Missing X-PagerDuty-Signature" };
      let matched = false;
      for (const candidate of candidates) matched = safeEqual(candidate.slice(3).toLowerCase(), expected) || matched;
      return matched ? { ok: true } : { ok: false, reason: "Signature does not match" };
    }
    case "linear": {
      const signature = headers["linear-signature"] ?? "";
      if (!signature) return { ok: false, reason: "Missing Linear-Signature" };
      if (!safeEqual(signature.toLowerCase(), hmacHex(secret, rawBody))) return { ok: false, reason: "Signature does not match" };
      // Signed with the body, so checked after the signature.
      const sentAt = Number(get(parseBody(rawBody), "webhookTimestamp"));
      if (!withinWindow(sentAt / 1000, now, windowSeconds)) return { ok: false, reason: "Timestamp outside the replay window", replay: true };
      return { ok: true };
    }
    case "botmail":
      return { ok: false, reason: "Bot email arrives only through the Perspicax relay" };
  }
}

// ── normalization ────────────────────────────────────────────────────────

const REVIEW_KINDS = new Map([
  ["approved", "pr.review_approved"],
  ["changes_requested", "pr.review_changes_requested"],
  ["commented", "pr.review_commented"],
]);

function githubEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  const name = request.headers["x-github-event"] ?? "";
  const action = str(get(payload, "action"));
  const repo = str(get(payload, "repository", "full_name"));
  const sender = str(get(payload, "sender", "login"));
  // X-GitHub-Delivery is not signed: a replayed body with a new id must
  // still be a duplicate, so the key is the signed body itself.
  const deliveryKey = digest(request.rawBody);
  const one = (normalized: NormalizedTriggerEvent): NormalizeResult => ({ events: [{ event: normalized, dedupeKey: `github:${deliveryKey}` }] });
  if (name === "ping") return { ignored: "Ping from GitHub: the signature is valid" };
  if (name === "pull_request" || name === "pull_request_review" || name === "pull_request_review_comment" || name === "pull_request_review_thread") {
    const pr = get(payload, "pull_request");
    const base = {
      repo,
      branch: str(get(pr, "base", "ref")),
      label: names(get(pr, "labels"), "name"),
      sender,
    };
    const title = str(get(pr, "title")) ?? "Pull request";
    const extra = { url: str(get(pr, "html_url"), 500), text: str(get(pr, "body"), MAX_TEXT), occurredAt: str(get(pr, "updated_at")) };
    if (name === "pull_request_review") {
      if (action !== "submitted") return { ignored: `Review action “${action ?? "none"}” is not handled` };
      return one(event("github", REVIEW_KINDS.get(str(get(payload, "review", "state"))?.toLowerCase() ?? "") ?? "pr.review_submitted", title, {
        ...base, reviewer: str(get(payload, "review", "user", "login")),
      }, {
        ...extra, url: str(get(payload, "review", "html_url"), 500) ?? extra.url, text: str(get(payload, "review", "body"), MAX_TEXT) ?? extra.text,
      }));
    }
    if (name === "pull_request_review_comment") {
      if (action !== "created") return { ignored: `Review comment action “${action ?? "none"}” is not handled` };
      const comment = get(payload, "comment");
      return one(event("github", "pr.review_comment", title, { ...base, reviewer: str(get(comment, "user", "login")) }, {
        url: str(get(comment, "html_url"), 500) ?? extra.url, text: str(get(comment, "body"), MAX_TEXT), occurredAt: str(get(comment, "created_at")),
        fromBot: isBotAccount(get(comment, "user"), get(payload, "sender")),
      }));
    }
    if (name === "pull_request_review_thread") {
      const kind = action === "resolved" ? "pr.thread_resolved" : action === "unresolved" ? "pr.thread_reopened" : undefined;
      if (!kind) return { ignored: `Review thread action “${action ?? "none"}” is not handled` };
      const first = get(payload, "thread", "comments", 0);
      return one(event("github", kind, title, { ...base, reviewer: str(get(first, "user", "login")) }, {
        url: str(get(first, "html_url"), 500) ?? extra.url, text: str(get(first, "body"), MAX_TEXT),
      }));
    }
    if (action === "opened" || action === "reopened" || action === "ready_for_review") return one(event("github", "pr.opened", title, base, extra));
    if (action === "synchronize") return one(event("github", "pr.updated", title, base, extra));
    if (action === "closed") return one(event("github", get(pr, "merged") === true ? "pr.merged" : "pr.closed", title, base, extra));
    if (action === "review_requested") {
      const reviewer = str(get(payload, "requested_reviewer", "login")) ?? str(get(payload, "requested_team", "slug"));
      return one(event("github", "pr.review_requested", title, { ...base, reviewer }, extra));
    }
    return { ignored: `Pull request action “${action ?? "none"}” is not handled` };
  }
  if (name === "workflow_run" || name === "check_suite") {
    if (action !== "completed") return { ignored: `${name} action “${action ?? "none"}” is not handled` };
    const run = get(payload, name);
    const conclusion = str(get(run, "conclusion"));
    const kind = conclusion === "success" ? "ci.succeeded"
      : conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure" ? "ci.failed" : undefined;
    if (!kind) return { ignored: `CI conclusion “${conclusion ?? "none"}” is not handled` };
    const workflow = str(get(run, "name")) ?? str(get(run, "app", "name")) ?? "CI";
    return one(event("github", kind, `${workflow}: ${conclusion}`, { repo, branch: str(get(run, "head_branch")), sender }, {
      url: str(get(run, "html_url"), 500), occurredAt: str(get(run, "updated_at")),
    }));
  }
  if (name === "issues") {
    const kind = action === "opened" ? "issue.opened" : action === "assigned" ? "issue.assigned" : undefined;
    if (!kind) return { ignored: `Issue action “${action ?? "none"}” is not handled` };
    const issue = get(payload, "issue");
    return one(event("github", kind, str(get(issue, "title")) ?? "Issue", {
      repo, label: names(get(issue, "labels"), "name"), sender, assignee: kind === "issue.assigned" ? identities(get(payload, "assignee"), "login", "id") : undefined,
    }, {
      url: str(get(issue, "html_url"), 500), text: str(get(issue, "body"), MAX_TEXT),
    }));
  }
  if (name === "issue_comment") {
    if (action !== "created") return { ignored: `Comment action “${action ?? "none"}” is not handled` };
    const issue = get(payload, "issue");
    // GitHub sends PR conversation comments as issue comments; only those
    // on a pull request are a PR comment.
    if (get(issue, "pull_request") === undefined) return { ignored: "Comment on an issue, not a pull request, is not handled" };
    const comment = get(payload, "comment");
    return one(event("github", "pr.comment", str(get(issue, "title")) ?? "Pull request", { repo, label: names(get(issue, "labels"), "name"), sender }, {
      url: str(get(comment, "html_url"), 500) ?? str(get(issue, "html_url"), 500), text: str(get(comment, "body"), MAX_TEXT), occurredAt: str(get(comment, "created_at")),
      fromBot: isBotAccount(get(comment, "user"), get(payload, "sender")),
    }));
  }
  if (name === "push") {
    const ref = str(get(payload, "ref")) ?? "";
    const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : ref;
    const commits = Array.isArray(get(payload, "commits")) ? (get(payload, "commits") as unknown[]) : [];
    return one(event("github", "push", `Push to ${branch || "a ref"} (${commits.length} commits)`, { repo, branch, sender }, {
      url: str(get(payload, "compare"), 500),
      text: commits.slice(0, 20).map((commit) => str(get(commit, "message"), 200)).filter(Boolean).join("\n"),
    }));
  }
  if (name === "release") {
    if (action !== "published") return { ignored: `Release action “${action ?? "none"}” is not handled` };
    const release = get(payload, "release");
    return one(event("github", "release.published", str(get(release, "name")) ?? str(get(release, "tag_name")) ?? "Release", { repo, sender }, {
      url: str(get(release, "html_url"), 500), text: str(get(release, "body"), MAX_TEXT),
    }));
  }
  return { ignored: `GitHub event “${name || "none"}” is not handled` };
}

function gitlabEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  const name = request.headers["x-gitlab-event"] ?? "";
  const attrs = get(payload, "object_attributes");
  const repo = str(get(payload, "project", "path_with_namespace"));
  const sender = str(get(payload, "user", "username")) ?? str(get(payload, "user_username"));
  const label = names(get(payload, "labels"), "title");
  const key = digest(request.rawBody);
  const one = (normalized: NormalizedTriggerEvent): NormalizeResult => ({ events: [{ event: normalized, dedupeKey: `gitlab:${key}` }] });
  const extra = { url: str(get(attrs, "url"), 500), text: str(get(attrs, "description"), MAX_TEXT) };
  if (name === "Merge Request Hook") {
    const action = str(get(attrs, "action"));
    const kind = action === "open" || action === "reopen" ? "mr.opened" : action === "merge" ? "mr.merged" : action === "close" ? "mr.closed" : undefined;
    if (!kind) return { ignored: `Merge request action “${action ?? "none"}” is not handled` };
    return one(event("gitlab", kind, str(get(attrs, "title")) ?? "Merge request", { repo, branch: str(get(attrs, "target_branch")), label, sender }, extra));
  }
  if (name === "Pipeline Hook") {
    const status = str(get(attrs, "status"));
    const kind = status === "failed" ? "pipeline.failed" : status === "success" ? "pipeline.succeeded" : undefined;
    if (!kind) return { ignored: `Pipeline status “${status ?? "none"}” is not handled` };
    return one(event("gitlab", kind, `Pipeline ${status} on ${str(get(attrs, "ref")) ?? "a ref"}`, { repo, branch: str(get(attrs, "ref")), sender }, extra));
  }
  if (name === "Issue Hook") {
    const action = str(get(attrs, "action"));
    if (action !== "open") return { ignored: `Issue action “${action ?? "none"}” is not handled` };
    return one(event("gitlab", "issue.opened", str(get(attrs, "title")) ?? "Issue", { repo, label, sender }, extra));
  }
  if (name === "Push Hook") {
    const ref = str(get(payload, "ref")) ?? "";
    const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : ref;
    return one(event("gitlab", "push", `Push to ${branch || "a ref"}`, { repo, branch, sender }));
  }
  return { ignored: `GitLab event “${name || "none"}” is not handled` };
}

function slackEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  if (get(payload, "type") !== "event_callback") return { ignored: `Slack payload “${str(get(payload, "type")) ?? "none"}” is not handled` };
  const inner = get(payload, "event");
  const type = str(get(inner, "type"));
  // Messages from bots (including this one) never start a run: no loops.
  if (get(inner, "bot_id") !== undefined || get(inner, "subtype") === "bot_message") return { ignored: "Message from a bot" };
  const eventId = str(get(payload, "event_id")) ?? digest(request.rawBody);
  const team = str(get(payload, "team_id"));
  const sender = str(get(inner, "user"));
  const one = (normalized: NormalizedTriggerEvent): NormalizeResult => ({ events: [{ event: normalized, dedupeKey: `slack:${eventId}` }] });
  const occurredAt = Number(get(payload, "event_time")) > 0 ? new Date(Number(get(payload, "event_time")) * 1000).toISOString() : undefined;
  if (type === "app_mention") {
    return one(event("slack", "mention", "Mention in Slack", { channel: str(get(inner, "channel")), sender, team }, {
      text: str(get(inner, "text"), MAX_TEXT), occurredAt,
    }));
  }
  if (type === "reaction_added") {
    const reaction = str(get(inner, "reaction"), 100);
    return one(event("slack", "reaction", `:${reaction ?? "?"}: reaction in Slack`, {
      channel: str(get(inner, "item", "channel")), sender, reaction, team,
    }, { occurredAt, resource: str(get(inner, "item", "ts")) }));
  }
  if (type === "message") {
    if (get(inner, "subtype") !== undefined) return { ignored: `Message subtype “${str(get(inner, "subtype")) ?? ""}” is not handled` };
    return one(event("slack", "message", "Message in Slack", { channel: str(get(inner, "channel")), sender, team }, {
      text: str(get(inner, "text"), MAX_TEXT), occurredAt,
    }));
  }
  return { ignored: `Slack event “${type ?? "none"}” is not handled` };
}

function graphEvents(type: TriggerSourceType, payload: JsonValue | undefined): NormalizeResult {
  const notifications = get(payload, "value");
  if (!Array.isArray(notifications)) return { ignored: "Not a Microsoft Graph notification" };
  const events: SourceEvent[] = [];
  for (const notification of notifications.slice(0, 50)) {
    if (get(notification, "lifecycleEvent") !== undefined) continue;
    const changeType = str(get(notification, "changeType"));
    const resource = str(get(notification, "resource"), 500) ?? "";
    const kind = type === "teams"
      ? changeType === "created" ? "message.created" : changeType === "updated" ? "message.updated" : undefined
      : type === "email"
        ? changeType === "created" ? "email.received" : undefined
        : changeType === "created" ? "event.created" : changeType === "updated" ? "event.updated" : changeType === "deleted" ? "event.cancelled" : undefined;
    if (!kind) continue;
    const fields: NormalizedTriggerEvent["fields"] = {};
    if (type === "teams") {
      fields.team = resource.match(/teams(?:\('|\/)([^')/]+)/i)?.[1];
      fields.channel = resource.match(/channels(?:\('|\/)([^')/]+)/i)?.[1] ?? resource.match(/chats(?:\('|\/)([^')/]+)/i)?.[1];
    }
    const title = type === "teams" ? "Microsoft Teams message" : type === "email" ? "New email in Outlook" : `Calendar event ${changeType ?? ""}`.trim();
    const key = [str(get(notification, "subscriptionId")), changeType, resource, str(get(notification, "resourceData", "id")),
      str(get(notification, "resourceData", "@odata.etag"))].join("|");
    events.push({ event: event(type, kind, title, fields, { resource }), dedupeKey: `${type}:${digest(key)}` });
  }
  return events.length ? { events } : { ignored: "No handled change in this Microsoft Graph notification" };
}

// Sentry renamed "ignored" to "archived"; both mean the issue was archived.
const SENTRY_ISSUE_KINDS = new Map([
  ["created", "issue.created"],
  ["resolved", "issue.resolved"],
  ["assigned", "issue.assigned"],
  ["archived", "issue.archived"],
  ["ignored", "issue.archived"],
  ["unresolved", "issue.unresolved"],
]);

function sentryEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  const resource = request.headers["sentry-hook-resource"] ?? "";
  const action = str(get(payload, "action"));
  const data = get(payload, "data");
  // Request-ID and Sentry-Hook-Timestamp are not signed: the body is.
  const key = digest(request.rawBody);
  const one = (normalized: NormalizedTriggerEvent): NormalizeResult => ({ events: [{ event: normalized, dedupeKey: `sentry:${key}` }] });
  if (resource === "issue") {
    const kind = SENTRY_ISSUE_KINDS.get(action ?? "");
    if (!kind) return { ignored: `Sentry issue action “${action ?? "none"}” is not handled` };
    const issue = get(data, "issue");
    return one(event("sentry", kind, str(get(issue, "title")) ?? "Sentry issue", {
      project: str(get(issue, "project", "slug")), level: str(get(issue, "level")),
      assignee: identities(get(issue, "assignedTo"), "name", "email", "id"),
    }, { url: str(get(issue, "web_url"), 500), text: str(get(issue, "culprit"), MAX_TEXT) }));
  }
  if (resource === "event_alert" || resource === "metric_alert") {
    const alertEvent = get(data, "event");
    const title = str(get(data, "metric_alert", "title")) ?? str(get(alertEvent, "title")) ?? str(get(data, "triggered_rule")) ?? "Sentry alert";
    return one(event("sentry", "alert.triggered", title, {
      project: str(get(alertEvent, "project")) ?? str(get(data, "metric_alert", "projects", 0)),
      environment: str(get(alertEvent, "environment")),
      level: str(get(alertEvent, "level")) ?? action,
    }, { url: str(get(alertEvent, "web_url"), 500) ?? str(get(data, "web_url"), 500) }));
  }
  if (resource === "error") {
    const errorEvent = get(data, "error");
    return one(event("sentry", "error.created", str(get(errorEvent, "title")) ?? "Sentry error", {
      project: str(get(errorEvent, "project")), environment: str(get(errorEvent, "environment")), level: str(get(errorEvent, "level")),
    }, { url: str(get(errorEvent, "web_url"), 500), text: str(get(errorEvent, "culprit"), MAX_TEXT) }));
  }
  return { ignored: `Sentry resource “${resource || "none"}” is not handled` };
}

function pagerdutyEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  const inner = get(payload, "event");
  const kind = str(get(inner, "event_type"));
  if (!kind || !TRIGGER_SOURCES.pagerduty.events.includes(kind)) return { ignored: `PagerDuty event “${kind ?? "none"}” is not handled` };
  const data = get(inner, "data");
  const id = str(get(inner, "id")) ?? digest(request.rawBody);
  return {
    events: [{
      event: event("pagerduty", kind, str(get(data, "title")) ?? "PagerDuty incident", {
        service: str(get(data, "service", "summary")),
        urgency: str(get(data, "urgency")),
        team: names(get(data, "teams"), "summary"),
      }, { url: str(get(data, "html_url"), 500), occurredAt: str(get(inner, "occurred_at")) }),
      dedupeKey: `pagerduty:${id}`,
    }],
  };
}

function linearEvents(request: SourceRequest, payload: JsonValue | undefined): NormalizeResult {
  const type = str(get(payload, "type"));
  const action = str(get(payload, "action"));
  const data = get(payload, "data");
  const key = digest(request.rawBody);
  const updatedFrom = get(payload, "updatedFrom");
  const changed = (field: string) => updatedFrom !== null && typeof updatedFrom === "object" && Object.hasOwn(updatedFrom, field);
  const sender = str(get(payload, "actor", "name")) ?? str(get(payload, "actor", "email"));
  if (type === "Cycle") {
    // A cycle completes when its completedAt goes from empty to set.
    if (action !== "update" || !changed("completedAt") || !str(get(data, "completedAt"))) {
      return { ignored: `Linear Cycle “${action ?? "none"}” is not a completed cycle` };
    }
    const number = str(get(data, "number"));
    return {
      events: [{
        event: event("linear", "cycle.completed", str(get(data, "name")) ?? (number ? `Cycle ${number}` : "Linear cycle"), {
          team: str(get(data, "team", "key")), sender,
        }, { url: str(get(payload, "url"), 500), text: str(get(data, "description"), MAX_TEXT), occurredAt: str(get(data, "completedAt")) }),
        dedupeKey: `linear:${key}`,
      }],
    };
  }
  const kind = type === "Issue"
    ? action === "create" ? "issue.created"
      : action === "update" ? changed("stateId") ? "issue.status_changed" : "issue.updated"
        : action === "remove" ? "issue.removed" : undefined
    : type === "Comment" && action === "create" ? "comment.created" : undefined;
  if (!kind) return { ignored: `Linear ${type ?? "event"} “${action ?? "none"}” is not handled` };
  const issue = type === "Comment" ? get(data, "issue") : data;
  return {
    events: [{
      event: event("linear", kind, str(get(issue, "title")) ?? "Linear issue", {
        team: str(get(issue, "team", "key")) ?? str(get(data, "team", "key")),
        project: str(get(issue, "project", "name")),
        label: names(get(issue, "labels"), "name"),
        status: str(get(issue, "state", "name")),
        assignee: identities(get(issue, "assignee"), "name", "displayName", "email", "id"),
        sender,
      }, { url: str(get(payload, "url"), 500), text: str(get(data, "body"), MAX_TEXT) ?? str(get(data, "description"), MAX_TEXT), occurredAt: str(get(payload, "createdAt")) }),
      dedupeKey: `linear:${key}`,
    }],
  };
}

export function normalizeSource(type: TriggerSourceType, request: SourceRequest): NormalizeResult {
  const payload = parseBody(request.rawBody);
  if (payload === undefined) return { ignored: "The body is not JSON" };
  switch (type) {
    case "github": return githubEvents(request, payload);
    case "gitlab": return gitlabEvents(request, payload);
    case "slack": return slackEvents(request, payload);
    case "teams":
    case "email":
    case "calendar": return graphEvents(type, payload);
    case "sentry": return sentryEvents(request, payload);
    case "pagerduty": return pagerdutyEvents(request, payload);
    case "linear": return linearEvents(request, payload);
    case "botmail": return { ignored: "Bot email arrives only through the Perspicax relay" };
  }
}

// ── filters ──────────────────────────────────────────────────────────────

function globMatches(pattern: string, value: string): boolean {
  const source = pattern.trim().toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}$`).test(value.trim().toLowerCase());
}

export type FilterResult =
  | { match: true; deferred: Array<{ key: TriggerFilterKey; values: string[] }> }
  | { match: false; reason: string };

/** Event kind first, then each filter key with values. A key the provider
 * sent nothing for is deferred when the source says so (Graph basic
 * notifications), else it is a miss: a filter never passes by absence. */
export function matchSourceFilters(config: TriggerSourceConfig, normalized: NormalizedTriggerEvent): FilterResult {
  if (!triggerEventSelected(config.type, config.events, normalized.kind, config.catalog)) {
    return { match: false, reason: `Event “${normalized.kind}” is not selected` };
  }
  if (normalized.fromBot && !config.includeBotComments) {
    return { match: false, reason: "Comment posted by a GitHub app or bot: this trigger leaves those out" };
  }
  const deferrable = new Set(TRIGGER_SOURCES[config.type].deferredFilters ?? []);
  const contains = new Set(TRIGGER_SOURCES[config.type].containsFilters ?? []);
  const deferred: Array<{ key: TriggerFilterKey; values: string[] }> = [];
  for (const [rawKey, rawValues] of Object.entries(config.filters)) {
    const key = rawKey as TriggerFilterKey;
    const values = (rawValues ?? []).map((value) => value.trim()).filter(Boolean);
    if (!values.length) continue;
    if (key === "keyword") {
      const haystack = `${normalized.title}\n${normalized.text ?? ""}`.toLowerCase();
      if (normalized.text === undefined && deferrable.has(key)) {
        deferred.push({ key, values });
        continue;
      }
      if (!values.some((value) => haystack.includes(value.toLowerCase()))) return { match: false, reason: "No keyword matched" };
      continue;
    }
    const field = normalized.fields[key];
    if (field === undefined || (Array.isArray(field) && field.length === 0)) {
      if (deferrable.has(key)) {
        deferred.push({ key, values });
        continue;
      }
      return { match: false, reason: `Filter “${key}” has nothing to match in this event` };
    }
    const candidates = Array.isArray(field) ? field : [field];
    const matches = contains.has(key)
      ? (pattern: string, candidate: string) => candidate.toLowerCase().includes(pattern.toLowerCase())
      : globMatches;
    if (!values.some((pattern) => candidates.some((candidate) => matches(pattern, candidate)))) {
      return { match: false, reason: `Filter “${key}” did not match` };
    }
  }
  return { match: true, deferred };
}

// ── test-fire ────────────────────────────────────────────────────────────

const SAMPLE_FIELDS: Partial<Record<TriggerFilterKey, string>> = {
  repo: "acme/api",
  branch: "main",
  label: "bug",
  sender: "octocat",
  reviewer: "octocat",
  assignee: "octocat",
  status: "In Progress",
  channel: "C0123456789",
  reaction: "eyes",
  team: "ENG",
  subject: "Weekly sync",
  organizer: "someone@example.com",
  series: "series-1",
  project: "web",
  environment: "production",
  level: "error",
  service: "API",
  urgency: "high",
};

/** A sample event that passes this trigger's own filters (first non-glob
 * value of each), so a test-fire exercises the whole path to a run. */
export function sampleSourceEvent(config: TriggerSourceConfig): NormalizedTriggerEvent {
  const definition = TRIGGER_SOURCES[config.type];
  const kind = config.events[0] ?? definition.events[0]!;
  const pick = (key: TriggerFilterKey) => config.filters[key]?.find((value) => value.trim() && !value.includes("*"))?.trim();
  const fields: NormalizedTriggerEvent["fields"] = {};
  for (const key of definition.filters) {
    if (key === "keyword") continue;
    const value = pick(key) ?? (config.type === "botmail" && key === "sender" ? "someone@example.com" : SAMPLE_FIELDS[key]);
    if (value) fields[key as Exclude<TriggerFilterKey, "keyword">] = value;
  }
  const keyword = pick("keyword");
  return event(config.type, kind, `Test event from Sagax${keyword ? `: ${keyword}` : ""}`, fields, {
    text: keyword ? `Sample text mentioning ${keyword}.` : "Sample text.",
    occurredAt: new Date().toISOString(),
  });
}
