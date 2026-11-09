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

const ATTACHMENT_TAG = /<attached-(image|file)\b([^>]*?)\/?>/gi;

export interface StrippedText {
  text: string;
  /** Display names of images attached inline (never paths). */
  images: string[];
  files: string[];
}

/** Removes the raw `<attached-image .../>` / `<attached-file .../>` tags the chat inlines; keeps only display names. */
export function stripAttachments(text: string | undefined): StrippedText {
  const images: string[] = [];
  const files: string[] = [];
  const cleaned = (text ?? "").replace(ATTACHMENT_TAG, (_all, kind: string, attrs: string) => {
    const name = /\bname="([^"]*)"/i.exec(attrs)?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
    const image = kind.toLowerCase() === "image";
    (image ? images : files).push(name || (image ? "image" : "file"));
    return " ";
  });
  return { text: cleaned.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), images, files };
}

/** First sentence (or clause) of a text, cut at a word boundary. */
function lead(text: string, max: number): string {
  const line = oneLine(text);
  const sentence = /^(.+?[.!?](?=\s|$))/.exec(line)?.[1] ?? line;
  if (sentence.length <= max) return sentence.replace(/[.!?]+$/, "");
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export function reportTitle(kind: FeedbackKind, summary: string, page?: string): string {
  const head = `[Feedback] ${KIND_WORD[kind]}: `;
  const where = page && page !== "unknown" && !/\s/.test(page.trim()) && page.length <= 30 ? ` (${page.trim()})` : "";
  const room = 100 - head.length - where.length;
  const line = oneLine(summary) || "(no summary)";
  return head + lead(line, Math.min(room, 70)) + where;
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
  const attachedImages: string[] = [];
  const attachedFiles: string[] = [];
  const clean = (text: string | undefined) => {
    const stripped = stripAttachments(text);
    attachedImages.push(...stripped.images);
    attachedFiles.push(...stripped.files);
    return anonymize(stripped.text, names).trim();
  };
  // Each answer is cleaned once up front so attachments are counted once.
  const field = {
    steps: clean(answers.steps),
    expected: clean(answers.expected),
    actual: clean(answers.actual),
    describe: clean(answers.describe),
    impact: clean(answers.impact),
  };
  const noun = kind === "bug" ? "a bug" : kind === "idea" ? "an idea" : "a question";
  const summarySource = kind === "bug" ? field.actual || field.describe || field.steps : field.describe;
  const point = summarySource ? lead(summarySource, 160) : "";
  const impactWord = field.impact ? ` Impact: ${oneLine(field.impact)}.` : "";
  const pageName = context.page && context.page !== "unknown" ? oneLine(anonymize(context.page, names)) : "";
  const where = pageName ? ` from the ${pageName} page` : "";
  const sections: string[] = [];
  sections.push(`## Summary\n\n${point ? `The person reported ${noun}${where}. Main point: ${point}.${impactWord} Their own wording is quoted below.` : "_No summary given._"}`);
  sections.push(`**Type:** ${KIND_WORD[kind]}${field.impact ? ` · **Impact:** ${field.impact}` : ""}`);
  if (kind === "bug") {
    const steps = field.steps.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    sections.push(`## Steps to reproduce\n\n${steps.length ? steps.map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "")}`).join("\n") : "_Not given._"}`);
    sections.push(`## Expected\n\n${field.expected ? quote(field.expected) : "_Not given._"}`);
    sections.push(`## Actual\n\n${field.actual ? quote(field.actual) : "_Not given._"}`);
  } else if (field.describe) {
    sections.push(`## ${kind === "idea" ? "Idea" : "Question"}\n\n${quote(field.describe)}`);
  }
  if (field.impact) sections.push(`## Impact\n\n${field.impact}`);
  if (answers.followups.length) {
    sections.push(`## Follow-up\n\n${answers.followups.map((item) => `- **${clean(item.question) || item.field}**\n  ${clean(item.answer)}`).join("\n")}`);
  }
  if (answers.extra?.length) sections.push(`## Added details\n\n${answers.extra.map((line) => `- ${clean(line)}`).join("\n")}`);
  const attachments: string[] = [];
  if (attachedImages.length) attachments.push(`- ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} attached by the person (${attachedImages.map((name) => oneLine(name)).join(", ")}), kept on the server and not published: a picture cannot be anonymized.`);
  if (attachedFiles.length) attachments.push(`- ${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""} attached by the person (${attachedFiles.map((name) => oneLine(name)).join(", ")}), kept on the server and not published.`);
  if (attachments.length) sections.push(`## Attachments\n\n${attachments.join("\n")}`);
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
    title: reportTitle(kind, point, pageName || undefined),
    body: sections.join("\n\n"),
    labels: [FEEDBACK_LABEL, FEEDBACK_UNTRIAGED_LABEL, FEEDBACK_KIND_LABEL[kind]],
  };
}
