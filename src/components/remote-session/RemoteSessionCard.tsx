import { AlertTriangle, ArrowUpRight, Cpu, HardDrive, MemoryStick, Rocket, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { RemoteSessionFacts } from "./RemoteSessionFacts";
import { RemoteScreenCard, remoteHasScreen } from "./RemoteScreenCard";

const SUGGESTION_LABEL: Record<string, LocaleKey> = {
  "disk-critical": "remoteSession.suggest.disk-critical",
  "disk-low": "remoteSession.suggest.disk-low",
  "ram-low": "remoteSession.suggest.ram-low",
  rights: "remoteSession.suggest.rights",
  cpu: "remoteSession.suggest.cpu",
  errors: "remoteSession.suggest.errors",
  startup: "remoteSession.suggest.startup",
};

const SUGGESTION_PROMPT: Record<string, LocaleKey> = {
  "disk-critical": "remoteSession.prompt.disk-critical",
  "disk-low": "remoteSession.prompt.disk-low",
  "ram-low": "remoteSession.prompt.ram-low",
  rights: "remoteSession.prompt.rights",
  cpu: "remoteSession.prompt.cpu",
  errors: "remoteSession.prompt.errors",
  startup: "remoteSession.prompt.startup",
};

const SUGGESTION_ICON: Record<string, LucideIcon> = {
  "disk-critical": HardDrive,
  "disk-low": HardDrive,
  "ram-low": MemoryStick,
  rights: ShieldCheck,
  cpu: Cpu,
  errors: AlertTriangle,
  startup: Rocket,
};

/** The short prompt a suggestion chip sends. Unknown ids send nothing. */
export function remoteSuggestionText(id: string, host: string): string | null {
  const key = SUGGESTION_PROMPT[id];
  return key ? t(key, { host }) : null;
}

/** The chat card for one remote computer: its live screen first, drawn like
 * the bot's own computer screen (RemoteScreenCard), then the facts and the
 * actions, details folded. A server without a desktop has no screen: its
 * facts card says shell only. Suggestions send a short prompt. */
export function RemoteSessionCard({ botId, threadId, view, detailsOpen = false }: { botId: string; threadId: string; view: RemoteSessionView; detailsOpen?: boolean }) {
  const { dispatch } = useStore();
  const host = publicText(view.hostname) || view.code;
  const ask = (id: string) => {
    const text = remoteSuggestionText(id, host);
    if (!text) return;
    dispatch({ type: "send", botId, threadId, text });
  };
  const hints = view.state === "connected" ? view.suggestions.filter((hint) => SUGGESTION_LABEL[hint.id]) : [];
  return (
    <div data-remote-session="" className="flex flex-col gap-3">
    {remoteHasScreen(view) && <RemoteScreenCard botId={botId} view={view} />}
    <div data-remote-session-card="" data-remote-state={view.state} className="@container/remote overflow-hidden rounded-xl border border-hairline text-ink">
      <RemoteSessionFacts view={view} detailsOpen={detailsOpen} botId={botId} />
      {hints.length > 0 && (
        <div data-remote-hints="" className="border-t border-hairline/40 px-3 pb-3 pt-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-tertiary">
            <Sparkles size={13} aria-hidden="true" />
            <span>{t("remoteSession.hints")}</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 @min-[440px]/remote:grid-cols-2">
            {hints.map((hint) => {
              const Icon = SUGGESTION_ICON[hint.id] ?? Sparkles;
              return (
                <button
                  key={hint.id}
                  type="button"
                  data-remote-hint={hint.id}
                  onClick={() => ask(hint.id)}
                  className="group flex h-9 min-w-0 items-center gap-2.5 rounded-lg border-[0.5px] border-border bg-elevated pl-1.5 pr-2.5 text-left text-[13px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-inset text-ink-secondary group-hover:text-ink">
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(SUGGESTION_LABEL[hint.id]!)}</span>
                  <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 motion-reduce:transition-none" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="border-t border-hairline/40">
        <RemoteSessionActions botId={botId} view={view} />
      </div>
    </div>
    </div>
  );
}
