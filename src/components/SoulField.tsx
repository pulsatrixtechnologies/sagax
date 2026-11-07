// The SOUL.md editor: the bot's standing instructions, byte-counted
// against the server cap, with a banner when the file on disk was edited
// outside the app. Edits go to the record through the normal bot patch;
// the server writes the mirror. A draft that is over the cap stays local
// and is never sent, so the counter is the only thing that turns red.
import { useEffect, useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { firstSentence, soulPatchFor, utf8Bytes } from "@/lib/soul";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { HelpTip, PILL, useSettingsSurface } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

type SoulRead = { soul: string; revision: string; bytes: number; limit: number; file: string; drift: boolean; fileText?: string };

export function SoulField({
  bot,
  onPatch,
  simple,
}: {
  bot: Bot;
  onPatch: (patch: { soul?: string; description?: string }) => void;
  /** The Simple bot panel's plain "Instructions" box: same value, save path
   * and drift banner, without the file name, mono font and byte counter
   * (the counter returns only when the text is over the cap). */
  simple?: { label: string; placeholder: string };
}) {
  const { dispatch, flushBotPatches } = useStore();
  const { request: api } = useBotEditor();
  const limit = BOT_PROFILE_LIMITS.soul;
  const [draft, setDraft] = useState(bot.soul ?? "");
  const [info, setInfo] = useState<SoulRead | null>(null);
  const [resolving, setResolving] = useState(false);
  // The bot's profile page (#2313): the label a 14px row title in the card,
  // the buttons pills, the drift notice a filled box with no outline.
  const plain = useSettingsSurface() === "plain";

  // A new bot, or a server-side change (drift resolved, another client),
  // replaces the draft. While the user types, the draft leads.
  useEffect(() => {
    setDraft(bot.soul ?? "");
  }, [bot.id, bot.soul]);

  // Mirror path, drift state, and file text don't depend on the soul text
  // itself, so this must not key off bot.soul: onPatch updates it
  // optimistically on every keystroke, which would refetch on every
  // keystroke. bot.soulDrift changes whenever the server's drift state
  // changes, and resolve() below already calls refresh() explicitly after
  // Apply/Discard, so nothing is lost by dropping bot.soul here.
  const refresh = () => {
    return flushBotPatches(bot.id)
      .then(() => api(`/api/bots/${bot.id}/soul`))
      .then((read: SoulRead) => setInfo(read))
      .catch(() => setInfo(null));
  };
  useEffect(() => { void refresh(); }, [bot.id, bot.soulDrift, flushBotPatches]);

  const bytes = utf8Bytes(draft);
  const over = bytes > limit;
  const change = (value: string) => {
    setDraft(value);
    const patch = soulPatchFor(value, limit);
    if (patch) onPatch(patch);
  };
  const resolve = async (action: "apply-file" | "discard-file") => {
    if (resolving || !info?.revision || typeof info.fileText !== "string") return;
    setResolving(true);
    try {
      await flushBotPatches(bot.id);
      await api(`/api/bots/${bot.id}/soul/${action}`, {
        method: "POST",
        body: JSON.stringify({ fileText: info.fileText, expectedRevision: info.revision }),
      });
    } catch (error: unknown) {
      dispatch({ type: "error", message: readableError(error) });
    } finally {
      await refresh();
      setResolving(false);
    }
  };
  const canMigrate = bot.description.length > 400 && !(bot.soul ?? "").trim();

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label id={`bot-soul-label-${bot.id}`} htmlFor={`bot-soul-${bot.id}`} className={simple ? "text-[12px] text-ink-secondary" : plain ? "text-[14px] leading-5 text-ink" : "text-[13px] text-ink-secondary"}>
          {simple ? simple.label : t("botPanel.soul.label")}
        </label>
        {!simple && (
          <span className="mr-auto">
            <HelpTip label={t("settings.moreAbout", { title: t("botPanel.soul.label") })}>
              {t("botPanel.soul.intro")} {t("botPanel.soul.context")}
              {info?.file ? <> {t("botPanel.soul.mirrored")} <span className="break-all font-mono">{info.file}</span>.</> : null}
            </HelpTip>
          </span>
        )}
        {!simple && canMigrate && (
          <button
            type="button"
            disabled={resolving}
            onClick={() => onPatch({ soul: bot.description, description: firstSentence(bot.description) })}
            className={plain ? PILL : "rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"}
          >
            {t("botPanel.soul.move")}
          </button>
        )}
      </div>
      {info?.drift && (
        <div className={plain ? "mb-2 rounded-lg bg-warning/10 p-3 text-[12px] text-ink" : "mb-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[12px] text-ink"}>
          <div className={plain ? "text-[14px] leading-5" : "font-medium"}>{t("botPanel.soul.drift")}</div>
          <div className="mt-1 text-ink-secondary">
            {t("botPanel.soul.driftHelp")} <span className="break-all">{info.file}</span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-control p-2 text-[11.5px]">{info.fileText}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={resolving} onClick={() => void resolve("apply-file")} className={plain ? PILL : "rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"}>
              {t("botPanel.soul.useFile")}
            </button>
            <button type="button" disabled={resolving} onClick={() => void resolve("discard-file")} className={plain ? PILL : "rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"}>
              {t("botPanel.soul.keepSaved")}
            </button>
          </div>
        </div>
      )}
      <MarkdownEditor
        id={`bot-soul-${bot.id}`}
        ariaLabelledBy={`bot-soul-label-${bot.id}`}
        dataField="soul"
        minHeight={simple ? 140 : 220}
        placeholder={simple ? simple.placeholder : t("botPanel.soul.placeholder")}
        invalid={over}
        disabled={resolving}
        value={draft}
        onChange={change}
        footer={(!simple || over) && (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("tabular-nums", over && (plain ? "text-danger" : "font-medium text-red-500"))}>
              {t("botPanel.prompt.bytes", { count: `${bytes.toLocaleString(activeLocale())} / ${limit.toLocaleString(activeLocale())}` })}
              {over ? t("botPanel.soul.notSaved") : ""}
            </span>
          </span>
        )}
      />
    </div>
  );
}
