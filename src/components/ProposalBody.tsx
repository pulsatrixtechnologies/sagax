// The body of a proposal card (a learned skill, a routine, a profile change,
// a rule, a team setup), in the chat and in the composer's box: one or two
// lines of summary in the interface font, then the complete text behind a
// disclosure. #2946: no giant raw block in the chat, nothing removed,
// everything one click away (a learned skill's SKILL.md, source and sha).
import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SkillRequestOldBuildNotice, SkillRequestPreview } from "@/components/SkillRequestPreview";
import type { SkillRequestCardData } from "../../shared/skill-request";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The first paragraph of a proposal's text, on one line: what the card
 * reads as before its disclosure is opened. A learned skill reads as its gist. */
export function proposalSummary(text: string | undefined, skillRequest?: SkillRequestCardData): string {
  const gist = collapse(skillRequest?.gist ?? "");
  if (gist) return gist;
  const first = (text ?? "").trim().split(/\n\s*\n/)[0] ?? "";
  return collapse(first);
}

export function ProposalBody({
  text,
  skillRequest,
  ariaLabel,
}: {
  /** the card's complete text (its subtitle, or the pending detail) */
  text?: string;
  skillRequest?: SkillRequestCardData;
  /** aria-label of the complete text once shown */
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const summary = proposalSummary(text, skillRequest);
  const full = (text ?? "").trim();
  // a skill always has its SKILL.md behind the disclosure; another proposal
  // only when its text says more than the summary line
  const hasMore = Boolean(skillRequest) || (full !== "" && collapse(full) !== summary);
  const warnings = skillRequest?.warnings.filter((warning) => warning.trim()) ?? [];
  return (
    <div data-proposal-body="">
      {summary && (
        <p data-proposal-summary="" className="mt-1 line-clamp-2 break-words text-[13px] leading-snug text-ink-secondary" title={summary}>
          {summary}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-warning" data-proposal-warnings="">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{warning}</span>
            </li>
          ))}
        </ul>
      )}
      {skillRequest && <SkillRequestOldBuildNotice request={skillRequest} />}
      {hasMore && (
        <div className="mt-1.5" data-proposal-details={open ? "open" : "closed"}>
          <button
            type="button"
            aria-expanded={open}
            {...(skillRequest ? { "data-skill-md-toggle": "" } : {})}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md py-0.5 text-[12.5px] font-medium text-ink-secondary hover:text-ink"
          >
            <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")} />
            {skillRequest
              ? open ? t("skillRequest.hideSkillMd") : t("skillRequest.viewSkillMd")
              : open ? t("approval.details.hideFull") : t("approval.details.viewFull")}
          </button>
          {open && (
            <>
              {full && (
                <pre
                  tabIndex={0}
                  aria-label={ariaLabel}
                  className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
                >
                  {full}
                </pre>
              )}
              {skillRequest && <SkillRequestPreview request={skillRequest} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
