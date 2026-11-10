// About me: free text every bot receives with each turn, private or group
// (server/system-prompt.ts userProfileSystemPrompt). Settings > General shows
// one row with its first line; the editor is the sub-page General > About me
// (src/components/SettingsSubPage.tsx): a full-height field that saves as you
// type, a character count, a short guide, and the block bots receive.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, useStore } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { createAboutMeDraft } from "./about-me-draft";
import { MarkdownEditor } from "./markdown/MarkdownEditor";

/** The server's limit (server/config.ts profile.aboutMe). */
export const ABOUT_ME_MAX = 24_000;

const drafts = new WeakMap<object, ReturnType<typeof createAboutMeDraft>>();

function useAboutMeDraft() {
  const { state, dispatch } = useStore();
  const confirmed = state.config?.profile?.aboutMe ?? "";
  let controller = drafts.get(dispatch);
  if (!controller) {
    controller = createAboutMeDraft(confirmed, async (sent) => {
      // #3424: the person's own About me (the operator's is the server's profile)
      const saved = await api<{ aboutMe?: string }>("/api/me/about-me", {
        method: "PUT", body: JSON.stringify({ aboutMe: sent }), timeoutMs: 10_000,
      });
      dispatch({ type: "profileSaved", profile: { aboutMe: saved.aboutMe ?? sent } });
    });
    drafts.set(dispatch, controller);
  }
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { flush } = controller;
  useEffect(() => { controller.confirm(confirmed); }, [controller, confirmed]);
  // Leaving the page (back, another section, closing Settings) saves now.
  useEffect(() => () => { void flush(); }, [flush]);
  return { controller, dispatch, ...snapshot };
}

/** The first non-empty line, for the row on General; "Not set" when empty. */
export function aboutMeFirstLine(aboutMe: string | undefined): string {
  const line = (aboutMe ?? "").split("\n").map((entry) => entry.trim()).find(Boolean);
  return line ? line.replace(/^#+\s*/, "") : t("settings.card.notSet");
}

/** "1,234 / 24,000 characters" in the active language's digits. */
export function aboutMeCount(length: number): string {
  let format = (value: number) => String(value);
  try {
    const numbers = new Intl.NumberFormat(activeLocale());
    format = (value) => numbers.format(value);
  } catch {
    /* an unknown locale keeps plain digits */
  }
  return t("settings.aboutMe.count", { count: format(length), max: format(ABOUT_ME_MAX) });
}

/** What a bot receives, as the person can read it: the heading the system
 * prompt uses, then the text; empty when there is nothing to send. */
export function aboutMeBotPreview(aboutMe: string): string {
  const text = aboutMe.trim();
  return text ? `About the user (shared with all bots):\n${text}` : "";
}

/** The outline "Insert an outline" adds: after the text, or alone. */
export function withOutline(aboutMe: string, outline: string): string {
  const base = aboutMe.replace(/\s+$/, "");
  return (base ? `${base}\n\n${outline}` : outline).slice(0, ABOUT_ME_MAX);
}

function SaveStatus({ status, onRetry }: { status: string; onRetry: () => void }) {
  return (
    <span role="status" className="min-w-0 truncate">
      {status === "saving" && <span className="text-ink-secondary">{t("settings.profile.saving")}</span>}
      {status === "saved" && <span className="text-success">{t("settings.profile.saved")}</span>}
      {status === "idle" && <span className="text-ink-secondary">{t("settings.aboutMe.autosave")}</span>}
      {status === "error" && <span className="text-danger">{t("settings.profile.saveError")}{" "}
        <button type="button" onClick={onRetry} className="underline">{t("settings.profile.retry")}</button>
      </span>}
    </span>
  );
}

/** Settings > General > About me: the full-height editor. */
export function AboutMeEditor() {
  const { controller, dispatch, value, status } = useAboutMeDraft();
  const preview = aboutMeBotPreview(value);
  const tips = ["settings.aboutMe.tipWho", "settings.aboutMe.tipAnswers", "settings.aboutMe.tipContext", "settings.aboutMe.tipNever"] as const;
  return (
    <div data-about-me-editor className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      <div className="flex min-h-[300px] min-w-0 flex-1 flex-col gap-2">
        <p className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.profile.aboutMeHelp")}</p>
        <label id="profile-about-me-label" htmlFor="profile-about-me" className="sr-only">{t("settings.profile.aboutMe")}</label>
        <MarkdownEditor
          id="profile-about-me"
          ariaLabelledBy="profile-about-me-label"
          dataField="about-me"
          className="min-h-[240px] flex-1"
          minHeight={240}
          maxHeight="none"
          value={value}
          maxLength={ABOUT_ME_MAX}
          showCount={false}
          autoFocus
          placeholder={t("settings.aboutMe.placeholder")}
          onChange={(next) => controller.edit(next)}
          onBlur={() => void controller.flush()}
          footer={
            <span className="flex items-center justify-between gap-3 text-[12px]">
              <SaveStatus status={status} onRetry={() => void controller.flush()} />
              <span data-about-me-count className="shrink-0 tabular-nums text-ink-secondary">{aboutMeCount(value.length)}</span>
            </span>
          }
        />
        <LearnedFacts onChanged={(aboutMe) => { controller.confirm(aboutMe); dispatch({ type: "profileSaved", profile: { aboutMe } }); }} />
      </div>
      <aside className="flex shrink-0 flex-col gap-4 md:w-[230px]">
        <section aria-labelledby="about-me-guide">
          <h3 id="about-me-guide" className="text-[13px] font-semibold text-ink">{t("settings.aboutMe.guideTitle")}</h3>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-[17px] text-ink-secondary">
            {tips.map((key) => <li key={key}>{t(key)}</li>)}
          </ul>
          <p className="mt-2 text-[12px] leading-[17px] text-ink-secondary">{t("settings.aboutMe.markdown")}</p>
          <button
            type="button"
            onClick={() => controller.edit(withOutline(value, t("settings.aboutMe.outline")))}
            className="ui-button mt-2"
          >
            {t("settings.aboutMe.insertOutline")}
          </button>
        </section>
        <section aria-labelledby="about-me-preview">
          <h3 id="about-me-preview" className="text-[13px] font-semibold text-ink">{t("settings.aboutMe.previewTitle")}</h3>
          <p className="mt-1 text-[12px] leading-[17px] text-ink-secondary">{t("settings.aboutMe.previewNote")}</p>
          {preview ? (
            <pre data-about-me-preview className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[11.5px] leading-[16px] text-ink">{preview}</pre>
          ) : (
            <p data-about-me-preview className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("settings.aboutMe.previewEmpty")}</p>
          )}
        </section>
      </aside>
    </div>
  );
}

interface LearnedFact {
  id: string;
  text: string;
  botName: string;
  at: number;
}

/** What bots with Memory upkeep added to About me on their own, newest
 * first, each with Remove: About me reaches every bot, so the person can
 * always see and take back what was added for them. */
function LearnedFacts({ onChanged }: { onChanged: (aboutMe: string) => void }) {
  const [facts, setFacts] = useState<LearnedFact[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ learned: LearnedFact[] }>("/api/profile/learned")
      .then((result) => { if (!cancelled) setFacts(result.learned); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const remove = async (id: string) => {
    setBusy(id);
    setError(false);
    try {
      const result = await api<{ aboutMe: string; learned: LearnedFact[] }>(`/api/profile/learned/${encodeURIComponent(id)}/remove`, { method: "POST" });
      setFacts(result.learned);
      onChanged(result.aboutMe);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  if (!facts.length) return null;
  return (
    <div className="mt-1 rounded-lg border border-hairline/40 bg-inset p-3">
      <div className="text-[13px] font-medium text-ink">{t("settings.profile.learned.title")}</div>
      <p className="mt-0.5 text-[12px] text-ink-secondary">{t("settings.profile.learned.hint")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {facts.map((fact) => (
          <li key={fact.id} className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
            <span className="min-w-0 flex-1">
              {fact.text}{" "}
              <span className="text-[12px] text-ink-secondary">{t("settings.profile.learned.from", { name: fact.botName })}</span>
            </span>
            <button type="button" disabled={busy === fact.id} onClick={() => void remove(fact.id)}
              className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
              {t("settings.profile.learned.remove")}
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="mt-2 text-[12px] text-danger">{t("settings.profile.learned.error")}</div>}
    </div>
  );
}
