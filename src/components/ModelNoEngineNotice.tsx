// The model menu and the bot editor's model row on an organization server
// when nothing answers this person (2026-10-19): the list held only Auto,
// with nothing saying why. Says what to do: connect their own key or
// subscription (the same step as the first-run card), or ask an admin to
// give them an engine in Perspicax.
import { t } from "@/lib/i18n";
import { openOrgEngineSetup, usePersonEngineReadiness } from "@/lib/org-engine-readiness";
import { contactAdminText } from "./OrgEngineSetup";

export function ModelNoEngineNotice({ className, onConnect }: { className?: string; onConnect?: () => void }) {
  const readiness = usePersonEngineReadiness();
  if (!readiness.organization || (readiness.state !== "connect" && readiness.state !== "blocked")) return null;
  const blocked = readiness.state === "blocked";
  return (
    <div role="status" data-model-no-engine={readiness.state} className={className}>
      <p className="text-[12.5px] font-medium text-ink">{blocked ? t("orgEngines.blocked.title") : t("orgEngines.notice.title")}</p>
      <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
        {blocked ? `${t("orgEngines.blocked.body")} ${contactAdminText(readiness.adminNames)}` : t("model.noEngine.body")}
      </p>
      {!blocked && (
        <button
          type="button"
          data-model-no-engine-connect=""
          onClick={() => { onConnect?.(); openOrgEngineSetup(); }}
          className="mt-1.5 text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink"
        >
          {t("orgEngines.notice.connect")}
        </button>
      )}
    </div>
  );
}
