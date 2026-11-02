// A bug report drafted from a chat. Nothing is sent until the person agrees.
// The draft has no person name. An address in the excerpt is removed.
import { FEEDBACK_ADDRESS } from "./feedback";
import { emailMailtoUrl } from "./rich-blocks";

const ADDRESS = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;

export function bugReportExcerpt(text: string): string {
  return text.replace(ADDRESS, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 1500);
}

export function bugReportMailto(input: { excerpt: string; version: string }): string | null {
  const excerpt = bugReportExcerpt(input.excerpt);
  if (!excerpt) return null;
  return emailMailtoUrl({
    to: [FEEDBACK_ADDRESS],
    cc: [],
    bcc: [],
    subject: `Sagax bug (${input.version || "unknown"})`,
    body: `Version: ${input.version || "unknown"}\n\nWhat happened:\n${excerpt}\n`,
  }).url;
}

/** Opens the draft only after confirm returns true. Otherwise nothing is opened.
 * confirm may be async (the in-app dialog). */
export async function openBugReport(input: {
  excerpt: string;
  version: string;
  confirm: (preview: string) => boolean | Promise<boolean>;
  open: (url: string) => void;
}): Promise<boolean> {
  const url = bugReportMailto(input);
  if (!url) return false;
  const preview = bugReportExcerpt(input.excerpt).slice(0, 280);
  if (!(await input.confirm(preview))) return false;
  input.open(url);
  return true;
}
