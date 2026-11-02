import { useId, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { CodexMark } from "./ProviderIcons";

export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

export function ManageUsageLink({ href, className, children }: { href: string; className: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={(event) => {
    if (window.ogb?.openExternal) { event.preventDefault(); void openExternalLink(href); }
  }}>{t("engineSetup.chatgpt.manageUsage")}{children}</a>;
}

/** This marker dismisses a welcome message only; no sign-in data lives in the renderer. */
export function ChatGptPlanStatus({ instanceId }: { instanceId: string }) {
  const key = `omb:chatgpt-plan-welcome:${instanceId}`;
  const [acknowledged, setAcknowledged] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  const titleId = useId();

  const dismiss = () => {
    try { localStorage.setItem(key, "1"); } catch { /* Private browsing may block persistence. */ }
    setAcknowledged(true);
  };

  return <>
    <div data-chatgpt-plan-status className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-secondary">
      <span>{t("engineSetup.chatgpt.using")}</span>
      <ManageUsageLink href={CHATGPT_USAGE_URL} className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={11} /></ManageUsageLink>
    </div>
    {!acknowledged && (
      <div role="status" data-chatgpt-plan-welcome aria-labelledby={titleId} className="mt-2 rounded-xl border border-hairline bg-inset px-3 py-3 text-ink">
        <CodexMark size={22} />
        <h2 id={titleId} className="mt-2 text-[13px] font-medium">{t("engineSetup.chatgpt.welcome")}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("engineSetup.chatgpt.welcomeBody")}</p>
        <button type="button" onClick={dismiss} className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-app">
          {t("onboarding.spot.gotIt")}
        </button>
      </div>
    )}
  </>;
}
