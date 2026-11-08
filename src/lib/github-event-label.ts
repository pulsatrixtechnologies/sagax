// A GitHub event kind in plain words ("issue.opened" -> "Issue opened"), so a
// routine's trigger never shows the raw kind (2026-11-07, QA C2 point 8).
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export function githubEventLabel(kind: string): string {
  const key = `githubEvent.${kind}` as LocaleKey;
  const label = t(key);
  return label === key ? kind : label;
}
