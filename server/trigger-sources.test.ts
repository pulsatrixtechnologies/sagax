import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { TRIGGER_CATALOG_VERSION, type TriggerSourceConfig, type TriggerSourceType } from "../shared/trigger-sources.ts";
import {
  handshakeAfterAuth,
  handshakeBeforeAuth,
  matchSourceFilters,
  normalizeSource,
  safeEqual,
  sampleSourceEvent,
  verifySource,
  type SourceRequest,
} from "./trigger-sources.ts";

const SECRET = "test-signing-secret-0123456789";
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const hmac = (data: string, secret = SECRET) => createHmac("sha256", secret).update(data).digest("hex");

function request(body: unknown, headers: Record<string, string> = {}, query = ""): SourceRequest {
  return {
    headers,
    rawBody: typeof body === "string" ? body : JSON.stringify(body),
    query: new URLSearchParams(query),
    now: NOW,
  };
}

function config(type: TriggerSourceType, extra: Partial<TriggerSourceConfig> = {}): TriggerSourceConfig {
  return { type, events: [], filters: {}, ...extra };
}

function only(result: ReturnType<typeof normalizeSource>) {
  if ("ignored" in result) throw new Error(`ignored: ${result.ignored}`);
  expect(result.events).toHaveLength(1);
  return result.events[0]!;
}

const githubPr = {
  action: "opened",
  repository: { full_name: "acme/api" },
  sender: { login: "octocat" },
  pull_request: { title: "Fix login", html_url: "https://github.com/acme/api/pull/7", body: "Closes #3", base: { ref: "main" }, labels: [{ name: "bug" }], merged: false },
};

describe("safeEqual", () => {
  it("matches equal strings only, empty never", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
});

describe("GitHub", () => {
  const body = JSON.stringify(githubPr);
  const signed = (raw = body, secret = SECRET) => request(raw, {
    "x-hub-signature-256": `sha256=${hmac(raw, secret)}`, "x-github-event": "pull_request", "x-github-delivery": "d-1",
  });

  it("accepts a valid X-Hub-Signature-256", () => {
    expect(verifySource("github", signed(), SECRET)).toEqual({ ok: true });
  });
  it("refuses a wrong secret, a tampered body and a missing header", () => {
    expect(verifySource("github", signed(body, "other-secret-xyz"), SECRET).ok).toBe(false);
    const tampered = signed();
    tampered.rawBody = body.replace("Fix login", "Fix logout");
    expect(verifySource("github", tampered, SECRET).ok).toBe(false);
    expect(verifySource("github", request(body, { "x-github-event": "pull_request" }), SECRET).ok).toBe(false);
  });
  it("refuses when no secret is stored", () => {
    expect(verifySource("github", signed(), "").ok).toBe(false);
  });
  it("normalizes PR opened, merged, review requested and CI", () => {
    const opened = only(normalizeSource("github", signed()));
    expect(opened.dedupeKey).toMatch(/^github:[a-f0-9]{40}$/);
    expect(opened.event).toMatchObject({ source: "github", kind: "pr.opened", title: "Fix login", fields: { repo: "acme/api", branch: "main", label: ["bug"], sender: "octocat" } });

    const merged = { ...githubPr, action: "closed", pull_request: { ...githubPr.pull_request, merged: true } };
    expect(only(normalizeSource("github", request(merged, { "x-github-event": "pull_request" }))).event.kind).toBe("pr.merged");

    const review = { ...githubPr, action: "review_requested", requested_reviewer: { login: "hubot" } };
    expect(only(normalizeSource("github", request(review, { "x-github-event": "pull_request" }))).event.fields.reviewer).toBe("hubot");

    const ci = { action: "completed", repository: { full_name: "acme/api" }, workflow_run: { name: "build", conclusion: "failure", head_branch: "main" } };
    expect(only(normalizeSource("github", request(ci, { "x-github-event": "workflow_run" }))).event).toMatchObject({ kind: "ci.failed", fields: { branch: "main" } });
  });
  it("ignores pings and unhandled events with a reason", () => {
    expect(normalizeSource("github", request({ zen: "hi" }, { "x-github-event": "ping" }))).toEqual({ ignored: expect.stringContaining("Ping") });
    expect(normalizeSource("github", request({}, { "x-github-event": "star" }))).toEqual({ ignored: expect.stringContaining("star") });
  });
  it("keys dedupe on the signed body, never the unsigned delivery header", () => {
    const one = only(normalizeSource("github", request(body, { "x-github-event": "pull_request", "x-github-delivery": "d-1" })));
    const replayed = only(normalizeSource("github", request(body, { "x-github-event": "pull_request", "x-github-delivery": "forged-new-id" })));
    expect(replayed.dedupeKey).toBe(one.dedupeKey);
    const other = only(normalizeSource("github", request(body.replace("Fix login", "Fix signup"), { "x-github-event": "pull_request", "x-github-delivery": "d-1" })));
    expect(other.dedupeKey).not.toBe(one.dedupeKey);
  });
});

describe("GitLab", () => {
  it("checks X-Gitlab-Token in constant time", () => {
    expect(verifySource("gitlab", request({}, { "x-gitlab-token": SECRET }), SECRET)).toEqual({ ok: true });
    expect(verifySource("gitlab", request({}, { "x-gitlab-token": "nope" }), SECRET).ok).toBe(false);
    expect(verifySource("gitlab", request({}, {}), SECRET).ok).toBe(false);
  });
  it("normalizes a failed pipeline", () => {
    const body = { project: { path_with_namespace: "acme/web" }, user: { username: "dev" }, object_attributes: { status: "failed", ref: "main" } };
    expect(only(normalizeSource("gitlab", request(body, { "x-gitlab-event": "Pipeline Hook" }))).event).toMatchObject({ kind: "pipeline.failed", fields: { repo: "acme/web", branch: "main" } });
  });
});

describe("Slack", () => {
  const mention = { type: "event_callback", event_id: "Ev1", team_id: "T1", event_time: NOW / 1000, event: { type: "app_mention", channel: "C1", user: "U1", text: "<@B1> deploy status?" } };
  const body = JSON.stringify(mention);
  const signed = (timestamp = String(NOW / 1000), raw = body) => request(raw, {
    "x-slack-request-timestamp": timestamp, "x-slack-signature": `v0=${hmac(`v0:${timestamp}:${raw}`)}`,
  });

  it("accepts a valid v0 signature", () => {
    expect(verifySource("slack", signed(), SECRET)).toEqual({ ok: true });
  });
  it("refuses a bad signature", () => {
    const bad = signed();
    bad.headers["x-slack-signature"] = `v0=${hmac("other")}`;
    expect(verifySource("slack", bad, SECRET)).toMatchObject({ ok: false });
  });
  it("refuses a replay older than five minutes even with a valid signature", () => {
    const old = String(NOW / 1000 - 301);
    expect(verifySource("slack", signed(old), SECRET)).toMatchObject({ ok: false, replay: true });
    expect(verifySource("slack", signed(String(NOW / 1000 - 299)), SECRET)).toEqual({ ok: true });
  });
  it("answers url_verification after authentication only", () => {
    expect(handshakeAfterAuth("slack", { type: "url_verification", challenge: "abc" })).toEqual({ status: 200, contentType: "application/json", body: '{"challenge":"abc"}' });
    expect(handshakeAfterAuth("github", { type: "url_verification", challenge: "abc" })).toBeNull();
  });
  it("normalizes mentions and reactions, and never runs for bot messages", () => {
    expect(only(normalizeSource("slack", signed()))).toMatchObject({ dedupeKey: "slack:Ev1", event: { kind: "mention", fields: { channel: "C1", sender: "U1" }, text: "<@B1> deploy status?" } });
    const reaction = { type: "event_callback", event_id: "Ev2", event: { type: "reaction_added", user: "U2", reaction: "eyes", item: { channel: "C9", ts: "1.2" } } };
    expect(only(normalizeSource("slack", request(reaction))).event).toMatchObject({ kind: "reaction", fields: { channel: "C9", reaction: "eyes" } });
    const fromBot = { type: "event_callback", event_id: "Ev3", event: { type: "message", bot_id: "B1", channel: "C1", text: "hi" } };
    expect(normalizeSource("slack", request(fromBot))).toEqual({ ignored: "Message from a bot" });
  });
});

describe("Microsoft Graph (Teams, Outlook, Calendar)", () => {
  const notification = (clientState = SECRET, extra: Record<string, unknown> = {}) => ({
    value: [{
      subscriptionId: "sub-1", clientState, changeType: "created", tenantId: "tenant-a",
      resource: "teams('team-1')/channels('19:chan')/messages('m1')", resourceData: { id: "m1" }, ...extra,
    }],
  });

  it("echoes validationToken as plain text before authentication, for Graph sources only", () => {
    expect(handshakeBeforeAuth("teams", request("", {}, "validationToken=Validation%3A+token"))).toEqual({
      status: 200, contentType: "text/plain; charset=utf-8", body: "Validation: token",
    });
    expect(handshakeBeforeAuth("github", request("", {}, "validationToken=x"))).toBeNull();
    expect(handshakeBeforeAuth("teams", request("", {}))).toBeNull();
  });
  it("checks clientState on every notification of the batch", () => {
    expect(verifySource("teams", request(notification()), SECRET)).toEqual({ ok: true });
    expect(verifySource("teams", request(notification("wrong-state")), SECRET).ok).toBe(false);
    const mixed = { value: [notification().value[0], notification("wrong-state").value[0]] };
    expect(verifySource("teams", request(mixed), SECRET).ok).toBe(false);
    expect(verifySource("teams", request({ nope: 1 }), SECRET).ok).toBe(false);
  });
  it("restricts to the configured tenant", () => {
    expect(verifySource("email", request(notification()), SECRET, { tenantId: "tenant-a" })).toEqual({ ok: true });
    expect(verifySource("email", request(notification()), SECRET, { tenantId: "tenant-b" }).ok).toBe(false);
  });
  it("normalizes each notification with a stable dedupe key", () => {
    const first = only(normalizeSource("teams", request(notification())));
    expect(first.event).toMatchObject({ kind: "message.created", fields: { team: "team-1", channel: "19:chan" } });
    expect(only(normalizeSource("teams", request(notification()))).dedupeKey).toBe(first.dedupeKey);
    expect(only(normalizeSource("calendar", request(notification(SECRET, { changeType: "deleted", resource: "me/events/e1" })))).event.kind).toBe("event.cancelled");
    expect(normalizeSource("email", request(notification(SECRET, { changeType: "deleted" })))).toHaveProperty("ignored");
  });
});

describe("Sentry", () => {
  const body = JSON.stringify({ action: "created", data: { issue: { title: "TypeError", level: "error", project: { slug: "web" }, web_url: "https://sentry.io/x" } } });
  const signed = (timestamp = String(NOW / 1000)) => request(body, {
    "sentry-hook-signature": hmac(body), "sentry-hook-timestamp": timestamp, "sentry-hook-resource": "issue", "request-id": "r-1",
  });
  it("accepts a valid signature, refuses a bad one and a stale timestamp", () => {
    expect(verifySource("sentry", signed(), SECRET)).toEqual({ ok: true });
    const bad = signed();
    bad.headers["sentry-hook-signature"] = hmac(body, "nope-nope-nope");
    expect(verifySource("sentry", bad, SECRET).ok).toBe(false);
    expect(verifySource("sentry", signed(String(NOW / 1000 - 3_600)), SECRET)).toMatchObject({ ok: false, replay: true });
  });
  it("normalizes an issue", () => {
    const first = only(normalizeSource("sentry", signed()));
    const reId = signed();
    reId.headers["request-id"] = "r-2";
    expect(only(normalizeSource("sentry", reId)).dedupeKey).toBe(first.dedupeKey);
    expect(first).toMatchObject({ dedupeKey: expect.stringMatching(/^sentry:[a-f0-9]{40}$/), event: { kind: "issue.created", fields: { project: "web", level: "error" } } });
  });
});

describe("PagerDuty", () => {
  const body = JSON.stringify({ event: { id: "ev-9", event_type: "incident.triggered", occurred_at: "2026-10-16T11:59:00Z", data: { title: "API down", urgency: "high", service: { summary: "API" }, html_url: "https://pd/x" } } });
  it("accepts any matching v1 signature (rotation), refuses otherwise", () => {
    expect(verifySource("pagerduty", request(body, { "x-pagerduty-signature": `v1=${hmac(body)}` }), SECRET)).toEqual({ ok: true });
    expect(verifySource("pagerduty", request(body, { "x-pagerduty-signature": `v1=${hmac(body, "old-secret-0000")},v1=${hmac(body)}` }), SECRET)).toEqual({ ok: true });
    expect(verifySource("pagerduty", request(body, { "x-pagerduty-signature": `v1=${hmac(body, "old-secret-0000")}` }), SECRET).ok).toBe(false);
    expect(verifySource("pagerduty", request(body, {}), SECRET).ok).toBe(false);
  });
  it("normalizes an incident, deduplicated by event id", () => {
    expect(only(normalizeSource("pagerduty", request(body)))).toMatchObject({ dedupeKey: "pagerduty:ev-9", event: { kind: "incident.triggered", fields: { service: "API", urgency: "high" } } });
  });
});

describe("Linear", () => {
  const payload = (sentAt = NOW) => JSON.stringify({ action: "create", type: "Issue", webhookTimestamp: sentAt, url: "https://linear.app/x", actor: { name: "Ana" }, data: { title: "Crash", team: { key: "ENG" }, labels: [{ name: "Bug" }] } });
  it("accepts a valid signature within a minute, refuses a bad one and a replay", () => {
    const body = payload();
    expect(verifySource("linear", request(body, { "linear-signature": hmac(body) }), SECRET)).toEqual({ ok: true });
    expect(verifySource("linear", request(body, { "linear-signature": hmac(body, "nope-nope-nope") }), SECRET).ok).toBe(false);
    const old = payload(NOW - 120_000);
    expect(verifySource("linear", request(old, { "linear-signature": hmac(old) }), SECRET)).toMatchObject({ ok: false, replay: true });
  });
  it("normalizes an issue", () => {
    const body = payload();
    expect(only(normalizeSource("linear", request(body, { "linear-delivery": "ld-1" }))).dedupeKey).toBe(only(normalizeSource("linear", request(body, { "linear-delivery": "ld-2" }))).dedupeKey);
    expect(only(normalizeSource("linear", request(body, { "linear-delivery": "ld-1" })))).toMatchObject({ dedupeKey: expect.stringMatching(/^linear:[a-f0-9]{40}$/), event: { kind: "issue.created", fields: { team: "ENG", label: ["Bug"], sender: "Ana" } } });
  });
});

describe("filters", () => {
  const pr = only(normalizeSource("github", request(githubPr, { "x-github-event": "pull_request" }))).event;

  it("passes with no filters and selected events", () => {
    expect(matchSourceFilters(config("github"), pr)).toEqual({ match: true, deferred: [] });
    expect(matchSourceFilters(config("github", { events: ["pr.opened"] }), pr).match).toBe(true);
  });
  it("refuses an event kind not selected", () => {
    expect(matchSourceFilters(config("github", { events: ["ci.failed"] }), pr)).toEqual({ match: false, reason: expect.stringContaining("pr.opened") });
  });
  it("matches exact values and globs, case-insensitively", () => {
    expect(matchSourceFilters(config("github", { filters: { repo: ["ACME/API"] } }), pr).match).toBe(true);
    expect(matchSourceFilters(config("github", { filters: { repo: ["acme/*"] } }), pr).match).toBe(true);
    expect(matchSourceFilters(config("github", { filters: { repo: ["other/*"] } }), pr).match).toBe(false);
    expect(matchSourceFilters(config("github", { filters: { label: ["bug", "p1"] } }), pr).match).toBe(true);
    expect(matchSourceFilters(config("github", { filters: { label: ["p1"] } }), pr).match).toBe(false);
  });
  it("treats regex characters literally", () => {
    expect(matchSourceFilters(config("github", { filters: { repo: ["acme.api"] } }), pr).match).toBe(false);
  });
  it("needs every key to match, keywords search title and text", () => {
    expect(matchSourceFilters(config("github", { filters: { repo: ["acme/api"], sender: ["someone"] } }), pr).match).toBe(false);
    expect(matchSourceFilters(config("github", { filters: { keyword: ["closes #3"] } }), pr).match).toBe(true);
    expect(matchSourceFilters(config("github", { filters: { keyword: ["deploy"] } }), pr).match).toBe(false);
  });
  it("never passes a filter by absence, except deferred Graph fields", () => {
    expect(matchSourceFilters(config("github", { filters: { reviewer: ["hubot"] } }), pr).match).toBe(false);
    const mail = only(normalizeSource("email", request({ value: [{ clientState: SECRET, changeType: "created", resource: "me/messages/1", resourceData: { id: "1" } }] }))).event;
    expect(matchSourceFilters(config("email", { filters: { sender: ["boss@example.com"] } }), mail)).toEqual({
      match: true, deferred: [{ key: "sender", values: ["boss@example.com"] }],
    });
  });
  it("builds a test sample that passes the trigger's own filters", () => {
    const own = config("github", { events: ["ci.failed"], filters: { repo: ["acme/*", "acme/web"], keyword: ["deploy"] } });
    const sample = sampleSourceEvent(own);
    expect(sample).toMatchObject({ kind: "ci.failed", fields: { repo: "acme/web" } });
    expect(matchSourceFilters(own, sample).match).toBe(true);
  });
});

describe("parity R5: GitHub comments, reviews, threads, assignment and updates", () => {
  const gh = (name: string, payload: unknown) => only(normalizeSource("github", request(payload, { "x-github-event": name })));
  const base = { repository: { full_name: "acme/api" }, sender: { login: "octocat" }, pull_request: githubPr.pull_request };

  it("tells an approval, a change request and a comment review apart", () => {
    const review = (state: string) => gh("pull_request_review", { ...base, action: "submitted", review: { state, body: "Looks good", user: { login: "hubot" } } });
    expect(review("approved").event).toMatchObject({ kind: "pr.review_approved", text: "Looks good", fields: { reviewer: "hubot", repo: "acme/api" } });
    expect(review("changes_requested").event.kind).toBe("pr.review_changes_requested");
    expect(review("commented").event.kind).toBe("pr.review_commented");
    expect(review("APPROVED").event.kind).toBe("pr.review_approved");
    expect(review("something_new").event.kind).toBe("pr.review_submitted");
    expect(review("constructor").event.kind).toBe("pr.review_submitted");
  });
  it("still runs a trigger that picked “any review” for every review outcome", () => {
    const approved = gh("pull_request_review", { ...base, action: "submitted", review: { state: "approved", user: { login: "hubot" } } }).event;
    expect(matchSourceFilters(config("github", { events: ["pr.review_submitted"] }), approved).match).toBe(true);
    expect(matchSourceFilters(config("github", { events: ["pr.review_approved"] }), approved).match).toBe(true);
    expect(matchSourceFilters(config("github", { events: ["pr.review_changes_requested"] }), approved).match).toBe(false);
  });
  it("normalizes a PR comment, never a plain issue comment", () => {
    const comment = { action: "created", repository: base.repository, sender: { login: "ana" },
      issue: { title: "Fix login", html_url: "https://github.com/acme/api/pull/7", labels: [{ name: "bug" }], pull_request: { url: "https://api.github.com/repos/acme/api/pulls/7" } },
      comment: { body: "Can you add a test?", html_url: "https://github.com/acme/api/pull/7#issuecomment-1" } };
    expect(gh("issue_comment", comment).event).toMatchObject({
      kind: "pr.comment", title: "Fix login", text: "Can you add a test?", url: "https://github.com/acme/api/pull/7#issuecomment-1",
      fields: { repo: "acme/api", sender: "ana", label: ["bug"] },
    });
    const onIssue = { ...comment, issue: { ...comment.issue, pull_request: undefined } };
    expect(normalizeSource("github", request(onIssue, { "x-github-event": "issue_comment" }))).toEqual({ ignored: expect.stringContaining("issue") });
    expect(normalizeSource("github", request({ ...comment, action: "deleted" }, { "x-github-event": "issue_comment" }))).toEqual({ ignored: expect.stringContaining("deleted") });
  });
  it("normalizes an inline review comment", () => {
    const inline = { ...base, action: "created", comment: { body: "Off by one here", path: "src/a.ts", html_url: "https://github.com/acme/api/pull/7#discussion_r1", user: { login: "hubot" } } };
    expect(gh("pull_request_review_comment", inline).event).toMatchObject({
      kind: "pr.review_comment", text: "Off by one here", url: "https://github.com/acme/api/pull/7#discussion_r1", fields: { reviewer: "hubot", branch: "main" },
    });
  });
  it("normalizes a review thread resolved and reopened", () => {
    const thread = (action: string) => ({ ...base, action, thread: { comments: [{ body: "Rename this", user: { login: "hubot" } }] } });
    expect(gh("pull_request_review_thread", thread("resolved")).event).toMatchObject({ kind: "pr.thread_resolved", text: "Rename this" });
    expect(gh("pull_request_review_thread", thread("unresolved")).event.kind).toBe("pr.thread_reopened");
  });
  it("normalizes new commits on a PR as an update, and an issue assignment with its assignee", () => {
    expect(gh("pull_request", { ...githubPr, action: "synchronize" }).event.kind).toBe("pr.updated");
    const assigned = gh("issues", { action: "assigned", repository: base.repository, sender: { login: "octocat" }, assignee: { login: "ana" },
      issue: { title: "Crash on save", html_url: "https://github.com/acme/api/issues/9", labels: [] } });
    expect(assigned.event).toMatchObject({ kind: "issue.assigned", fields: { assignee: ["ana"], repo: "acme/api" } });
    expect(matchSourceFilters(config("github", { catalog: 2, filters: { assignee: ["ana"] } }), assigned.event).match).toBe(true);
    expect(matchSourceFilters(config("github", { catalog: 2, filters: { assignee: ["bob"] } }), assigned.event).match).toBe(false);
  });
});

describe("parity R7: Sentry archived and unresolved", () => {
  const sentry = (action: string, issue: Record<string, unknown> = {}) => only(normalizeSource("sentry", request(
    { action, data: { issue: { title: "TypeError", level: "error", project: { slug: "web" }, ...issue } } }, { "sentry-hook-resource": "issue" },
  ))).event;
  it("normalizes archived (and the older ignored) and unresolved", () => {
    expect(sentry("archived").kind).toBe("issue.archived");
    expect(sentry("ignored").kind).toBe("issue.archived");
    expect(sentry("unresolved").kind).toBe("issue.unresolved");
    expect(normalizeSource("sentry", request({ action: "constructor", data: { issue: {} } }, { "sentry-hook-resource": "issue" }))).toEqual({ ignored: expect.stringContaining("constructor") });
  });
  it("keeps the assignee of an assignment", () => {
    expect(sentry("assigned", { assignedTo: { type: "user", name: "Ana", email: "ana@example.com" } }).fields.assignee).toEqual(["Ana", "ana@example.com"]);
  });
});

describe("parity R6: Linear status change and cycle completed", () => {
  const linear = (payload: unknown) => normalizeSource("linear", request(payload));
  const issue = { title: "Crash", team: { key: "ENG" }, state: { name: "Done" }, assignee: { name: "Ana" } };
  it("tells a status change from another update, and a trigger on “updated” still runs for it", () => {
    const moved = only(linear({ action: "update", type: "Issue", data: issue, updatedFrom: { stateId: "s-1", updatedAt: "x" } })).event;
    expect(moved).toMatchObject({ kind: "issue.status_changed", fields: { status: "Done", assignee: ["Ana"], team: "ENG" } });
    expect(matchSourceFilters(config("linear", { events: ["issue.updated"] }), moved).match).toBe(true);
    expect(matchSourceFilters(config("linear", { events: ["issue.status_changed"], filters: { status: ["done"] } }), moved).match).toBe(true);
    const renamed = only(linear({ action: "update", type: "Issue", data: issue, updatedFrom: { title: "Old" } })).event;
    expect(renamed.kind).toBe("issue.updated");
    expect(matchSourceFilters(config("linear", { events: ["issue.status_changed"] }), renamed).match).toBe(false);
  });
  it("normalizes a cycle that just completed, ignores other cycle updates", () => {
    const done = only(linear({ action: "update", type: "Cycle", url: "https://linear.app/c/1", data: { name: "Sprint 12", number: 12, completedAt: "2026-10-21T00:00:00Z", team: { key: "ENG" } }, updatedFrom: { completedAt: null } })).event;
    expect(done).toMatchObject({ kind: "cycle.completed", title: "Sprint 12", fields: { team: "ENG" }, url: "https://linear.app/c/1" });
    expect(only(linear({ action: "update", type: "Cycle", data: { number: 4, completedAt: "2026-10-21T00:00:00Z" }, updatedFrom: { completedAt: null } })).event.title).toBe("Cycle 4");
    expect(linear({ action: "update", type: "Cycle", data: { name: "Sprint 12" }, updatedFrom: { name: "S12" } })).toEqual({ ignored: expect.stringContaining("Cycle") });
  });
});

describe("review fixes: legacy “every event”, bot comments, assignee identities", () => {
  const gh = (name: string, payload: unknown) => only(normalizeSource("github", request(payload, { "x-github-event": name }))).event;
  const prComment = (userType: string, senderType = userType) => ({
    action: "created", repository: { full_name: "acme/api" }, sender: { login: "ci-bot[bot]", type: senderType },
    issue: { title: "Fix login", pull_request: { url: "x" } }, comment: { body: "Coverage 80%", user: { login: "ci-bot[bot]", type: userType } },
  });

  it("keeps a trigger saved before the new events on the old set when nothing is checked", () => {
    const comment = gh("issue_comment", prComment("User"));
    const opened = gh("pull_request", githubPr);
    const approved = gh("pull_request_review", { ...githubPr, action: "submitted", review: { state: "approved", user: { login: "hubot" } } });
    const legacy = config("github");
    expect(matchSourceFilters(legacy, comment)).toEqual({ match: false, reason: expect.stringContaining("pr.comment") });
    expect(matchSourceFilters(legacy, opened).match).toBe(true);
    expect(matchSourceFilters(legacy, approved).match).toBe(true);
    expect(matchSourceFilters(config("github", { catalog: TRIGGER_CATALOG_VERSION }), comment).match).toBe(true);
    const cycle = only(normalizeSource("linear", request({ action: "update", type: "Cycle", data: { name: "S1", completedAt: "2026-10-21" }, updatedFrom: { completedAt: null } }))).event;
    const status = only(normalizeSource("linear", request({ action: "update", type: "Issue", data: { title: "x" }, updatedFrom: { stateId: "s" } }))).event;
    expect(matchSourceFilters(config("linear"), cycle).match).toBe(false);
    expect(matchSourceFilters(config("linear"), status).match).toBe(true);
    const archived = only(normalizeSource("sentry", request({ action: "archived", data: { issue: { title: "x" } } }, { "sentry-hook-resource": "issue" }))).event;
    expect(matchSourceFilters(config("sentry"), archived).match).toBe(false);
    expect(matchSourceFilters(config("sentry", { catalog: TRIGGER_CATALOG_VERSION }), archived).match).toBe(true);
    // Sources without new events are unchanged.
    const page = only(normalizeSource("pagerduty", request({ event: { id: "e", event_type: "incident.triggered", data: { title: "x" } } }))).event;
    expect(matchSourceFilters(config("pagerduty"), page).match).toBe(true);
  });

  it("never runs for a comment a GitHub app or bot posted, unless the trigger opts in", () => {
    const fromBot = gh("issue_comment", prComment("Bot"));
    const inline = gh("pull_request_review_comment", { ...githubPr, action: "created", sender: { login: "x[bot]", type: "Bot" }, comment: { body: "nit", user: { login: "x[bot]", type: "Bot" } } });
    const own = config("github", { catalog: TRIGGER_CATALOG_VERSION });
    expect(matchSourceFilters(own, fromBot)).toEqual({ match: false, reason: expect.stringContaining("bot") });
    expect(matchSourceFilters(own, inline).match).toBe(false);
    expect(matchSourceFilters({ ...own, includeBotComments: true }, fromBot).match).toBe(true);
    expect(matchSourceFilters(own, gh("issue_comment", prComment("User", "Bot"))).match).toBe(false);
    expect(matchSourceFilters(own, gh("issue_comment", prComment("User"))).match).toBe(true);
  });

  it("offers every identity of an assignee to the filter", () => {
    const linear = only(normalizeSource("linear", request({ action: "update", type: "Issue", data: { title: "x", assignee: { id: "u-1", name: "Ana Roy", displayName: "ana", email: "ana@example.com" } }, updatedFrom: { stateId: "s" } }))).event;
    expect(linear.fields.assignee).toEqual(["Ana Roy", "ana", "ana@example.com", "u-1"]);
    for (const value of ["ana@example.com", "Ana Roy", "ana", "u-1"]) {
      expect(matchSourceFilters(config("linear", { filters: { assignee: [value] } }), linear).match).toBe(true);
    }
    const sentry = only(normalizeSource("sentry", request({ action: "assigned", data: { issue: { title: "x", assignedTo: { type: "user", id: "42", name: "Ana Roy", email: "ana@example.com" } } } }, { "sentry-hook-resource": "issue" }))).event;
    expect(sentry.fields.assignee).toEqual(["Ana Roy", "ana@example.com", "42"]);
    expect(matchSourceFilters(config("sentry", { filters: { assignee: ["42"] } }), sentry).match).toBe(true);
    const github = gh("issues", { action: "assigned", repository: { full_name: "a/b" }, assignee: { login: "ana", id: 7 }, issue: { title: "x" } });
    expect(github.fields.assignee).toEqual(["ana", "7"]);
  });
});
