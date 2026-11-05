// A published page the Claude harness (Artifact tool) or a ```artifact JSON
// fence handed us: title, an Open button for a real https URL, nothing
// invented. HTML previews ride a sibling ```widget fence, not this card.
import { memo } from "react";
import { Globe, SquareArrowOutUpRight } from "lucide-react";

import { t } from "@/lib/i18n";
import type { ArtifactPage } from "@/lib/rich-blocks";
import { isSafeHttpUrl } from "../../shared/claude-chat-blocks";

function openLink(url: string, event: { preventDefault(): void }) {
  if (typeof window !== "undefined" && window.ogb) {
    event.preventDefault();
    window.open(url, "_blank", "noopener");
  }
}

function ArtifactCardComponent({ page, pending = false }: { page: ArtifactPage; pending?: boolean }) {
  const url = page.url && isSafeHttpUrl(page.url) ? page.url : undefined;
  const title = page.title || t("rich.artifact.title");
  return (
    <article
      dir="auto"
      aria-label={t("rich.artifact.aria", { title })}
      className="my-2 min-w-0 overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <Globe size={14} aria-hidden="true" />
        <span className="font-medium text-ink">{t("rich.artifact.title")}</span>
        {pending && <span className="ms-auto text-[11px]">{t("rich.pending")}</span>}
      </header>
      <div className="flex flex-wrap items-center gap-2 px-3 py-3">
        <p className="min-w-0 flex-1 break-words text-[13px] font-semibold text-ink">{title}</p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => openLink(url, event)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <SquareArrowOutUpRight size={13} aria-hidden="true" />
            {t("rich.artifact.open")}
          </a>
        )}
      </div>
    </article>
  );
}

export const ArtifactCard = memo(ArtifactCardComponent);
