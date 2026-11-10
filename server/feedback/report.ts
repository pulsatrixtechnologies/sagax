// The issue a /feedback report becomes (#2618, #3299): a precise,
// structured body an engineer can act on without asking. It is built from
// named fields only: the person's words, the facts of the chat /feedback was
// typed in (chat-facts.ts: their last requests, the error, the turn and
// request ids, the failed tool calls), what the app attached (version,
// surface, page, OS, its own log) and what the server knows (its version,
// the bot's engine and model, recent warnings). Every line passes through
// the anonymizer. Pictures never leave: an image the person attached is only
// counted, since a picture cannot be anonymized.
import { FEEDBACK_KIND_LABEL, FEEDBACK_LABEL, FEEDBACK_UNTRIAGED_LABEL, type FeedbackKind, type FeedbackPlatform, type FeedbackSource } from "../../shared/feedback.ts";
import { anonymize, anonymizeLines, anonymizeWords, maskUnknownNames, type AnonymizeNames } from "./anonymize.ts";
import type { ChatFacts } from "./chat-facts.ts";
import { parseKind, type FeedbackAnswers } from "./flow.ts";

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
  /** The bot's engine (its driver kind) and model, from the server. */
  engine?: string;
  model?: string;
  /** What the chat /feedback was typed in says (chat-facts.ts). */
  chat?: ChatFacts;
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

const QUOTED = /("[^"\n]*"|'[^'\n]{2,}'|«[^»\n]*»|“[^”\n]*”)/g;

function maskQuoted(line: string): string {
  return line.replace(QUOTED, (part) => maskUnknownNames(part));
}

const PLATFORM_WORD: Record<FeedbackPlatform, string> = { desktop: "the desktop app", ios: "the iOS app", web: "the web app" };

/** A plain id (turn, request) as it is, or nothing. */
function plainId(id: string | undefined): string | undefined {
  return id && /^[A-Za-z0-9._:-]{4,80}$/.test(id) ? id : undefined;
}

const EXPECT = /(?:^|[\s,;(])(?:i\s+expected(?:\s+(?:that|to|it\s+to))?|expected(?::|\s+(?:that|to|it\s+to))|it\s+should(?:\s+have)?|should(?:\s+have)?|je\s+m['’]attendais\s+(?:à|a)|j['’]attendais|je\s+voulais|i\s+wanted(?:\s+to)?|(?:ça|ca|il|elle)\s+devrait|devrait|attendu\s*:)\s+(.+?)(?=[.;!?](?:\s|$)|\s(?:but|mais|instead|plutôt|au\s+lieu)\b|,\s*(?:but|mais)\b|$)/i;
const ACTUAL = /(?:^|[\s,;])(?:but|mais|instead|plutôt|au\s+lieu(?:\s+de\s+ça)?|actual(?:ly)?\s*:|résultat\s*:)[\s,]+(.+?)(?=[.;!?](?:\s|$)|$)/i;
const STEP_LINE = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;

export interface ReportShape {
  kind: FeedbackKind;
  steps: string[];
  expected?: string;
  actual?: string;
}

/** Kind, steps, expected and actual read from the person's words (already
 * anonymized) and the facts of the chat. */
export function reportShape(words: string, context: { error?: string; asks?: readonly string[]; surface?: string; page?: string; engine?: string; model?: string }): ReportShape {
  const kind = parseKind(words) ?? "bug";
  const flat = oneLine(words);
  const trim = (text: string | undefined) => text?.replace(/^[\s,;.:-]+|[\s,;:.-]+$/g, "").trim() || undefined;
  const found = EXPECT.exec(flat);
  const expected = trim(found?.[1]);
  let actual: string | undefined;
  if (found) {
    // what came before "I expected", and what came after "but"
    const before = trim(flat.slice(0, found.index));
    const after = trim(ACTUAL.exec(flat.slice(found.index))?.[1]);
    actual = [before, after].filter(Boolean).join(". ") || undefined;
  } else actual = trim(ACTUAL.exec(flat)?.[1]) ?? trim(flat);
  if (context.error) actual = actual ? `${actual}. The turn ends with the error below.` : "The turn ends with the error below.";
  const typed = words.split("\n").map((line) => STEP_LINE.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
  const steps: string[] = [];
  if (typed.length >= 2) steps.push(...typed);
  else {
    steps.push(`Open Sagax on ${context.surface ?? "any surface"}${context.page ? ` (${context.page} page)` : ""}.`);
    if (context.engine || context.model) steps.push(`Open a chat with a bot on the ${context.engine ?? "default"} engine${context.model ? `, model ${context.model}` : ""}.`);
    else steps.push("Open a chat with a bot.");
    for (const ask of context.asks ?? []) steps.push(`Send: "${lead(ask, 200)}"`);
    if (context.error) steps.push(`The turn fails with: "${lead(context.error, 200)}"`);
    else if (actual && kind === "bug") steps.push(`Observe: ${lead(actual, 200)}`);
  }
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  return { kind, steps, ...(expected ? { expected: capital(expected) } : {}), ...(actual ? { actual: capital(actual) } : {}) };
}

export function buildReport(answers: FeedbackAnswers, context: ReportContext, names: AnonymizeNames): FiledReport {
  const attachedImages: string[] = [];
  const attachedFiles: string[] = [];
  const clean = (text: string | undefined) => {
    const stripped = stripAttachments(text);
    attachedImages.push(...stripped.images);
    attachedFiles.push(...stripped.files);
    return anonymize(stripped.text, names).trim();
  };
  // the person's words and their chat requests name anyone freely: every
  // proper noun the server does not know goes too (anonymize.ts)
  const cleanWords = (text: string | undefined) => maskUnknownNames(clean(text));
  const said = cleanWords(answers.said);
  const detail = cleanWords(answers.detail);
  const extra = (answers.extra ?? []).map(cleanWords).filter(Boolean);
  const words = [said, detail].filter(Boolean).join("\n");
  const chat = context.chat;
  const asks = (chat?.asks ?? []).map(cleanWords).filter(Boolean);
  const error = context.error?.trim() || chat?.error?.trim() || "";
  // an error quotes the record it failed on ('Company "X" not found'): the
  // quoted part loses its proper nouns, the error's own words stay
  const errorLines = error ? anonymizeLines(error.split("\n"), names, 30).map(maskQuoted) : [];
  const pageName = context.page && context.page !== "unknown" ? oneLine(clean(context.page)) : "";
  const surface = context.platform ? PLATFORM_WORD[context.platform] : undefined;
  const engine = context.engine ? oneLine(clean(context.engine)) : undefined;
  const model = context.model || chat?.model ? oneLine(clean(context.model || chat?.model)) : undefined;
  const shape = reportShape(words, {
    ...(errorLines.length ? { error: errorLines.join(" ") } : {}),
    asks,
    ...(surface ? { surface } : {}),
    ...(pageName ? { page: pageName } : {}),
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
  });
  const kind = shape.kind;
  const noun = kind === "bug" ? "a bug" : kind === "idea" ? "an idea" : "a question";
  const point = shape.actual && kind === "bug" ? lead(shape.actual, 160) : words ? lead(words, 160) : errorLines.length ? lead(errorLines.join(" "), 160) : "";
  const doing = asks.length ? ` while asking a bot: "${lead(asks.at(-1)!, 140)}"` : "";
  const where = `${surface ? ` on ${surface}` : ""}${pageName ? ` (${pageName} page)` : ""}`;
  const sections: string[] = [];
  sections.push(`## Summary\n\n${point || doing
    ? `The person reported ${noun}${where}${doing}.${point ? ` ${kind === "bug" ? "What happened" : "Main point"}: ${point}.` : ""}`
    : "_No summary given._"}`);
  if (kind === "bug") {
    sections.push(`## Steps to reproduce\n\n${shape.steps.map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "")}`).join("\n")}`);
    sections.push(`## Expected\n\n${shape.expected ? shape.expected : error ? "The turn completes without an error." : "_Not stated by the person._"}`);
    sections.push(`## Actual\n\n${shape.actual ?? "_Not stated by the person._"}`);
  } else {
    sections.push(`## ${kind === "idea" ? "Idea" : "Question"}\n\n${words ? quote(words) : "_Not given._"}`);
  }
  if (asks.length) sections.push(`## What the person was doing\n\nTheir last requests in the chat, oldest first, anonymized.\n\n${asks.map((ask) => quote(ask)).join("\n\n")}`);
  if (words) sections.push(`## In their words\n\n${quote(words)}`);
  if (extra.length) sections.push(`## Added details\n\n${extra.map((line) => `- ${oneLine(line)}`).join("\n")}`);
  const attachments: string[] = [];
  if (attachedImages.length) attachments.push(`- ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} attached by the person (${attachedImages.map((name) => oneLine(anonymizeWords(name, names))).join(", ")}), kept on the server and not published: a picture cannot be anonymized.`);
  if (attachedFiles.length) attachments.push(`- ${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""} attached by the person (${attachedFiles.map((name) => oneLine(anonymizeWords(name, names))).join(", ")}), kept on the server and not published.`);
  if (attachments.length) sections.push(`## Attachments\n\n${attachments.join("\n")}`);
  const turnId = plainId(chat?.turnId);
  const requestIds = (chat?.requestIds ?? []).map(plainId).filter((id): id is string => Boolean(id));
  sections.push([
    "## Context",
    "",
    "| Field | Value |",
    "|---|---|",
    `| App version | ${cell(clean(context.appVersion))} |`,
    ...(context.serverVersion ? [`| Server version | ${cell(clean(context.serverVersion))} |`] : []),
    `| Surface | ${context.platform ?? "unknown"} |`,
    `| Page | ${cell(pageName)} |`,
    `| OS | ${cell(clean(context.os))} |`,
    `| Engine | ${cell(engine)} |`,
    `| Model | ${cell(model)} |`,
    ...(turnId ? [`| Turn id | ${turnId} |`] : []),
    ...(requestIds.length ? [`| Request ids | ${requestIds.join(", ")} |`] : []),
    ...(chat?.failedTools.length ? [`| Failed tool calls | ${cell(chat.failedTools.map((name) => clean(name)).join(", "))} |`] : []),
    `| Opened from | ${context.source === "slash" ? "/feedback" : context.source}${context.signal ? ` (${context.signal})` : ""} |`,
  ].join("\n"));
  if (errorLines.length) sections.push(`## Error\n\n${fenced(errorLines)}`);
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
  sections.push("---\n_Filed with /feedback in Sagax. Names of people, organizations, clients, bots and computers (including proper nouns in the person's words and requests), tickets, addresses, ids, paths and secrets are replaced by neutral words on the server before filing._");
  return {
    title: reportTitle(kind, point, pageName || undefined),
    body: sections.join("\n\n"),
    labels: [FEEDBACK_LABEL, FEEDBACK_UNTRIAGED_LABEL, FEEDBACK_KIND_LABEL[kind]],
  };
}
