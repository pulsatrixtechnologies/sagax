// The issue a feedback report becomes (#2618): a detailed, structured body
// built from named fields only (the person's answers and what the app
// attached), every line passed through the anonymizer. The screenshot stays
// on the server: a picture cannot be anonymized, so the body only says one
// was taken.
import { FEEDBACK_KIND_LABEL, FEEDBACK_LABEL, FEEDBACK_UNTRIAGED_LABEL, type FeedbackKind, type FeedbackPlatform, type FeedbackSource } from "../../shared/feedback.ts";
import { anonymize, anonymizeLines, type AnonymizeNames } from "./anonymize.ts";
import type { FeedbackAnswers } from "./flow.ts";

export interface ReportSpan {
  name: string;
  ms: number;
  ok: boolean;
}

export interface ReportContext {
  source: FeedbackSource;
  /** Absent: the report started from a typed message, no app attached it. */
  platform?: FeedbackPlatform;
  appVersion?: string;
  serverVersion?: string;
  os?: string;
  page?: string;
  error?: string;
  serverLines?: readonly string[];
  clientLogs?: readonly string[];
  spans?: readonly ReportSpan[];
  screenshot?: boolean;
  /** Why a bot offered the report (frustration signal), when it did. */
  signal?: string;
}

export interface FiledReport {
  title: string;
  body: string;
  labels: string[];
}

const KIND_WORD: Record<FeedbackKind, string> = { bug: "Bug", idea: "Idea", question: "Question" };

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function reportTitle(kind: FeedbackKind, summary: string): string {
  const head = `[Feedback] ${KIND_WORD[kind]}: `;
  const room = 100 - head.length;
  const line = oneLine(summary) || "(no summary)";
  return head + (line.length > room ? `${line.slice(0, room - 1)}…` : line);
}

function cell(text: string | undefined): string {
  return text ? oneLine(text).replace(/\|/g, "\\|") : "unknown";
}

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function fenced(lines: readonly string[]): string {
  return ["```text", ...lines.map((line) => line.replace(/```/g, "'''")), "```"].join("\n");
}

export function buildReport(answers: FeedbackAnswers, context: ReportContext, names: AnonymizeNames): FiledReport {
  const kind = answers.kind ?? "bug";
  const clean = (text: string | undefined) => anonymize(text ?? "", names).trim();
  const summarySource = kind === "bug" ? answers.actual || answers.describe || answers.steps : answers.describe;
  const summary = clean(summarySource);
  const sections: string[] = [];
  sections.push(`## Summary\n\n${summary ? quote(summary) : "_No summary given._"}`);
  sections.push(`**Type:** ${KIND_WORD[kind]}${answers.impact ? ` · **Impact:** ${clean(answers.impact)}` : ""}`);
  if (kind === "bug") {
    const steps = clean(answers.steps).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    sections.push(`## Steps to reproduce\n\n${steps.length ? steps.map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "")}`).join("\n") : "_Not given._"}`);
    sections.push(`## Expected\n\n${clean(answers.expected) ? quote(clean(answers.expected)) : "_Not given._"}`);
    sections.push(`## Actual\n\n${clean(answers.actual) ? quote(clean(answers.actual)) : "_Not given._"}`);
  } else if (answers.describe) {
    sections.push(`## ${kind === "idea" ? "Idea" : "Question"}\n\n${quote(clean(answers.describe))}`);
  }
  if (answers.impact) sections.push(`## Impact\n\n${clean(answers.impact)}`);
  if (answers.followups.length) {
    sections.push(`## Follow-up\n\n${answers.followups.map((item) => `- **${clean(item.question) || item.field}**\n  ${clean(item.answer)}`).join("\n")}`);
  }
  if (answers.extra?.length) sections.push(`## Added details\n\n${answers.extra.map((line) => `- ${clean(line)}`).join("\n")}`);
  sections.push([
    "## Context",
    "",
    "| Field | Value |",
    "|---|---|",
    `| App version | ${cell(clean(context.appVersion))} |`,
    ...(context.serverVersion ? [`| Server version | ${cell(clean(context.serverVersion))} |`] : []),
    `| OS | ${cell(clean(context.os))} |`,
    `| Platform | ${context.platform ?? "unknown"} |`,
    `| Page | ${cell(clean(context.page))} |`,
    `| Opened from | ${context.source}${context.signal ? ` (${context.signal})` : ""} |`,
    `| Screenshot | ${context.screenshot ? "taken, kept on the server (not published)" : "none"} |`,
  ].join("\n"));
  if (context.error) sections.push(`## Error\n\n${fenced(anonymizeLines(context.error.split("\n"), names, 30))}`);
  if (context.serverLines?.length) sections.push(`## Server log\n\nRecent warnings and errors, anonymized.\n\n${fenced(anonymizeLines(context.serverLines, names, 40))}`);
  if (context.clientLogs?.length) sections.push(`## App log\n\nRecent console lines, anonymized.\n\n${fenced(anonymizeLines(context.clientLogs, names, 40))}`);
  if (context.spans?.length) {
    sections.push([
      "## Recent spans",
      "",
      "| Span | Duration | Status |",
      "|---|---|---|",
      ...context.spans.slice(-20).map((span) => `| ${cell(clean(span.name))} | ${Math.round(span.ms)} ms | ${span.ok ? "ok" : "error"} |`),
    ].join("\n"));
  }
  sections.push("---\n_Filed by the in-app Feedback bot. Names, ids, addresses and paths are anonymized on the server before filing._");
  return {
    title: reportTitle(kind, summary),
    body: sections.join("\n\n"),
    labels: [FEEDBACK_LABEL, FEEDBACK_UNTRIAGED_LABEL, FEEDBACK_KIND_LABEL[kind]],
  };
}
