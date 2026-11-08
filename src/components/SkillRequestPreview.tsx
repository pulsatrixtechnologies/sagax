import { t } from "@/lib/i18n";
import { reviewedSkillSha256, type SkillRequestCardData } from "../../shared/skill-request";

/** A card from a build without reviewed hashes: deny-only, and it says so
 * in plain words on the card itself, never behind a disclosure. */
export function SkillRequestOldBuildNotice({ request }: { request: SkillRequestCardData }) {
  if (reviewedSkillSha256(request)) return null;
  return (
    <div className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[12px] leading-relaxed text-danger">
      {request.action === "update" ? t("skillRequest.oldBuildUpdate") : t("skillRequest.oldBuildCreate")}
    </div>
  );
}

/** Render learned instructions as inert plain text. The approval hash binds
 * this exact preview to the staged file the server will promote. Shown only
 * once the card's "View SKILL.md" disclosure is open (ProposalBody). */
export function SkillRequestPreview({ request }: { request: SkillRequestCardData }) {
  const reviewedSha256 = reviewedSkillSha256(request);
  if (!reviewedSha256) return null;
  return (
    <div className="mt-2 rounded-lg border border-hairline/40 bg-inset p-3" data-skill-md-body="">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-secondary">
        <span>
          {request.action === "update" ? t("skillRequest.reviewUpdate") : t("skillRequest.reviewCreate")}
        </span>
        <span className="font-mono" title={`sha256 ${reviewedSha256}`}>
          sha256 {reviewedSha256.slice(0, 8)}
        </span>
      </div>
      <div className="mt-1 break-all text-[11px] text-ink-secondary">
        {t("skillRequest.source", { source: request.source || t("skillRequest.unknownSource") })}
      </div>
      <pre
        tabIndex={0}
        aria-label={t("skillRequest.aria.fullSkillMd", { name: request.name })}
        className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
      >
        {request.preview}
      </pre>
    </div>
  );
}
