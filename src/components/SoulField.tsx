// The SOUL.md editor: the bot's standing instructions, byte-counted
// against the server cap, with a banner when the file on disk was edited
// outside the app. Edits go to the record through the normal bot patch;
// the server writes the mirror. A draft that is over the cap stays local
// and is never sent, so the counter is the only thing that turns red.
// #5019: the soul is identity, persona and voice only. While the person
// types, the patch is a draft; a moment after each pause the editor shows
// where Sagax will file what is not persona (a rule in Rules, a procedure or
// a reference in Files, a fact in Memory), and when the editor is left the
// server files it and the editor says what went where.
import { useEffect, useRef, useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { firstSentence, soulPatchFor, utf8Bytes } from "@/lib/soul";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { HelpTip, PILL, useSettingsSurface } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";
import type { SoulSortPreview, SoulSortReport } from "../../shared/soul-sort";

type SoulRead = { soul: string; revision: string; bytes: number; limit: number; file: string; drift: boolean; fileText?: string };

/** How long after a keystroke the editor asks where the new text will go. */
const PREVIEW_AFTER_MS = 1_200;

/** A destination as the person reads it. */
function sortDestination(to: string): string {
  if (to === "RULES.md") return t("botPanel.soul.sortToRules");
  if (to === "MEMORY.md") return t("botPanel.soul.sortToMemory");
  return t("botPanel.soul.sortToFiles", { path: to });
}

export function SoulField({
  bot,
  onPatch,
  simple,
  onOpenRules,
}: {
  bot: Bot;
  onPatch: (patch: { soul?: string; description?: string; soulDraft?: boolean }) => void;
  /** #5019: opens the bot's Rules, the editor of its own beside the soul. */
  onOpenRules?: () => void;
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
  // #5019: where the typed text will be filed, then what was filed
  const [preview, setPreview] = useState<SoulSortPreview | null>(null);
  const [sorted, setSorted] = useState<SoulSortReport | null>(null);
  const typed = useRef(false);
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
    setSorted(null);
    typed.current = true;
    const patch = soulPatchFor(value, limit);
    if (patch) onPatch({ ...patch, soulDraft: true });
  };

  // #5019: a moment after the person stops typing, where Sagax will file
  // what they added that is not persona. Nothing is written.
  useEffect(() => {
    if (!typed.current || over) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api(`/api/bots/${bot.id}/soul/preview`, { method: "POST", body: JSON.stringify({ soul: draft }) })
        .then((read: SoulSortPreview) => { if (live) setPreview(read.moves.length ? read : null); })
        .catch(() => { if (live) setPreview(null); });
    }, PREVIEW_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, bot.id, over]);

  // #5019: leaving the editor files what was typed; the answer says where
  const settle = async (mounted: boolean) => {
    if (!typed.current) return;
    typed.current = false;
    try {
      await flushBotPatches(bot.id);
      const read: { soulSorted?: SoulSortReport } = await api(`/api/bots/${bot.id}/soul/settle`, { method: "POST", body: "{}" });
      if (mounted) {
        setPreview(null);
        setSorted(read.soulSorted ?? null);
      }
    } catch (error: unknown) {
      if (mounted) dispatch({ type: "error", message: readableError(error) });
    }
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => () => { void settleRef.current(false); }, [bot.id]);
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
      <div
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void settle(true);
        }}
      >
      <MarkdownEditor
        id={`bot-soul-${bot.id}`}
        ariaLabelledBy={`bot-soul-label-${bot.id}`}
        dataField="soul"
        minHeight={simple ? 140 : 220}
        fillModal={!simple}
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
      {preview && (
        <div data-soul-sort-preview="" role="status" className="mt-2 rounded-lg bg-control p-3 text-[12px] text-ink">
          <div className={plain ? "text-[14px] leading-5" : "font-medium"}>{t("botPanel.soul.sortPreview")}</div>
          <ul className="mt-1 flex flex-col gap-1 text-ink-secondary">
            {preview.moves.map((move, index) => (
              <li key={`${move.to}-${index}`} className="min-w-0 break-words">
                {t("botPanel.soul.sortLine", { text: move.text, to: sortDestination(move.to) })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sorted && (sorted.moved.length > 0 || sorted.kept.length > 0) && (
        <div data-soul-sorted="" role="status" className="mt-2 rounded-lg bg-control p-3 text-[12px] text-ink">
          {sorted.moved.length > 0 && (
            <>
              <div className={plain ? "text-[14px] leading-5" : "font-medium"}>{t("botPanel.soul.sorted")}</div>
              <ul className="mt-1 flex flex-col gap-1 text-ink-secondary">
                {sorted.moved.map((move, index) => (
                  <li key={`${move.to}-${index}`} className="min-w-0 break-words">{t("botPanel.soul.sortLine", { text: move.text, to: sortDestination(move.to) })}</li>
                ))}
              </ul>
            </>
          )}
          {sorted.kept.length > 0 && (
            <>
              <div className={cn(sorted.moved.length > 0 && "mt-2", plain ? "text-[14px] leading-5" : "font-medium")}>{t("botPanel.soul.sortKept")}</div>
              <ul className="mt-1 flex flex-col gap-1 text-ink-secondary">
                {sorted.kept.map((kept, index) => (
                  <li key={`kept-${index}`} className="min-w-0 break-words">{kept.text}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {!simple && onOpenRules && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-secondary">
          <span>{t("botPanel.soul.rulesElsewhere")}</span>
          <button type="button" data-soul-open-rules="" onClick={onOpenRules} className={plain ? PILL : "rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"}>
            {t("botPanel.soul.openRules")}
          </button>
        </div>
      )}
    </div>
  );
}
