// Files a feedback report as a GitHub issue (#2618) with the server's own
// token (never sent to an app), makes sure the filing labels exist, folds a
// report into an open issue with a similar title as a +1 comment, and reads
// an issue's state back as the report's status.
import { FEEDBACK_IN_PROGRESS_LABEL, FEEDBACK_UNTRIAGED_LABEL, type FeedbackStatus } from "../../shared/feedback.ts";
import type { FiledReport } from "./report.ts";

export interface GithubFiler {
  /** owner/name */
  repo: string;
  token: string;
  fetch?: typeof fetch;
}

export interface FiledIssue {
  number: number;
  url: string;
  duplicate: boolean;
}

const API = "https://api.github.com";
const LABEL_STYLE: Record<string, { color: string; description: string }> = {
  feedback: { color: "5319e7", description: "Filed from the in-app Feedback bot" },
  [FEEDBACK_UNTRIAGED_LABEL]: { color: "fbca04", description: "In-app feedback not triaged yet" },
  [FEEDBACK_IN_PROGRESS_LABEL]: { color: "0e8a16", description: "In-app feedback being handled" },
};

async function call<T>(filer: GithubFiler, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const run = filer.fetch ?? fetch;
  const response = await run(`${API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${filer.token}`,
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

async function must<T>(filer: GithubFiler, method: string, path: string, body?: unknown): Promise<T> {
  const out = await call<T & { message?: string }>(filer, method, path, body);
  if (out.status >= 300) throw new Error(`GitHub ${method} ${path.split("?")[0]} failed (${out.status}${out.data?.message ? `: ${out.data.message}` : ""})`);
  return out.data;
}

export async function ensureLabels(filer: GithubFiler, labels: readonly string[]): Promise<void> {
  for (const name of new Set([...labels, ...Object.keys(LABEL_STYLE)])) {
    const found = await call(filer, "GET", `/repos/${filer.repo}/labels/${encodeURIComponent(name)}`);
    if (found.status === 200) continue;
    if (!LABEL_STYLE[name] && found.status === 404) {
      await call(filer, "POST", `/repos/${filer.repo}/labels`, { name, color: "ededed" });
      continue;
    }
    const created = await call<{ message?: string }>(filer, "POST", `/repos/${filer.repo}/labels`, { name, ...LABEL_STYLE[name] });
    // 422: created meanwhile by someone else.
    if (created.status >= 300 && created.status !== 422) throw new Error(`GitHub label ${name} could not be created (${created.status})`);
  }
}

function titleWords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/^\[feedback\]\s*\w+:\s*/, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2),
  );
}

export function similarTitle(a: string, b: string): boolean {
  const kind = (title: string) => /^\[feedback\]\s*(\w+):/i.exec(title)?.[1]?.toLowerCase();
  if (kind(a) !== kind(b)) return false;
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.75;
}

interface IssueLike {
  state?: string;
  labels?: ReadonlyArray<{ name?: string } | string>;
  assignees?: readonly unknown[];
}

export function statusOfIssue(issue: IssueLike): FeedbackStatus {
  if (issue.state === "closed") return "resolved";
  const labels = new Set((issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name ?? "")));
  if (labels.has(FEEDBACK_IN_PROGRESS_LABEL) || (issue.assignees?.length ?? 0) > 0) return "in_progress";
  if (labels.has(FEEDBACK_UNTRIAGED_LABEL)) return "sent";
  return "received";
}

export async function fileIssue(filer: GithubFiler, report: FiledReport): Promise<FiledIssue> {
  await ensureLabels(filer, report.labels);
  const open = await must<Array<{ number: number; title: string; html_url: string; pull_request?: unknown }>>(
    filer, "GET", `/repos/${filer.repo}/issues?labels=feedback&state=open&per_page=100`,
  );
  const twin = open.find((issue) => !issue.pull_request && similarTitle(issue.title, report.title));
  if (twin) {
    const context = report.body.split("\n## ").find((section) => section.startsWith("Context")) ?? "";
    await must(filer, "POST", `/repos/${filer.repo}/issues/${twin.number}/comments`, {
      body: `+1 from another in-app report: ${report.title}\n\n${context ? `## ${context}` : ""}`.trim(),
    });
    return { number: twin.number, url: twin.html_url, duplicate: true };
  }
  const created = await must<{ number: number; html_url: string }>(filer, "POST", `/repos/${filer.repo}/issues`, {
    title: report.title,
    body: report.body,
    labels: report.labels,
  });
  return { number: created.number, url: created.html_url, duplicate: false };
}

export async function issueStatus(filer: GithubFiler, number: number): Promise<FeedbackStatus> {
  return statusOfIssue(await must<IssueLike>(filer, "GET", `/repos/${filer.repo}/issues/${number}`));
}
