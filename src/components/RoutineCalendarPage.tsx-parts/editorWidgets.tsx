import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CheckCircle2, FileText, Search, Sparkles, X } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { PANEL_TEXT_ACTION } from "@/components/routines/PanelRows";
import type { CalendarCallAttachment } from "@/lib/calendar-calls";
import type { Attachment } from "@/lib/composer-attachments";
import type { Routine, RoutineContextAttachment } from "@/lib/routines";
import { appendComposerDraft } from "@/lib/drafts";
import { focusComposer } from "@/lib/composer-focus";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openBotThread, useStore, type Bot } from "@/state/store";

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Array<RoutineContextAttachment | CalendarCallAttachment>;
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex max-w-[260px] items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-2.5 py-2 text-[12px] text-ink">
          <FileText size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          {onRemove && <button type="button" onClick={() => onRemove(attachment.id)} className="rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("botPanel.skills.removeAria", { name: attachment.name })}><X size={12} /></button>}
        </div>
      ))}
    </div>
  );
}

export function BotPicker({
  bots,
  selected,
  multiple,
  locked,
  onChange,
}: {
  bots: Bot[];
  selected: string[];
  multiple: boolean;
  locked?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = bots.filter((bot) => `${bot.name} ${bot.title}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="rounded-xl border border-hairline/50 bg-inset/60 p-2">
      {!locked && bots.length > 5 && (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-transparent bg-panel px-2.5 py-2 text-ink-secondary focus-within:border-focus">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("routineCalendar.findBot")} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
      )}
      <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {filtered.map((bot) => {
          const active = selected.includes(bot.id);
          return (
            <button
              key={bot.id}
              type="button"
              disabled={locked}
              onClick={() => onChange(multiple ? (active ? selected.filter((id) => id !== bot.id) : [...selected, bot.id]) : [bot.id])}
              className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition", active ? "bg-accent/12 ring-1 ring-accent/50" : "hover:bg-raised", locked && "cursor-default")}
            >
              <BotAvatar bot={bot} state={active ? "happy" : "idle"} size={32} animated={false} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span>
              {active && <CheckCircle2 size={14} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function toContextAttachments(attachments: Attachment[]): Array<RoutineContextAttachment | CalendarCallAttachment> {
  return attachments.flatMap((attachment) => attachment.kind === "paste" || attachment.kind === "citation" ? [] : [{
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
  }]);
}

/** The instruction in view mode (2026-11-03, JC: Grok Bot): the whole text
 * flows; a long one folds after about 60% of the window with Show more. */
/** `short` (the side panel's routine page): folded to a few lines; `onEdit`
 * turns the text into its editor on a click or Enter (2026-11-06, JC). */
export function InstructionText({ text, short = false, onEdit }: { text: string; short?: boolean; onEdit?: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = body.current;
    if (element) setLong(element.scrollHeight > element.clientHeight + 4);
  }, [text]);
  const editProps = onEdit ? {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": t("routineEditor.editInstruction"),
    title: t("routineEditor.editInstruction"),
    onClick: (event: MouseEvent<HTMLElement>) => { if (!(event.target as HTMLElement).closest("a")) onEdit(); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEdit(); } },
  } : {};
  if (!text.trim()) return <p data-routine-instruction-text {...editProps} className={cn("text-[13.5px] text-ink-tertiary", onEdit && "-mx-2 cursor-text rounded-lg px-2 py-1.5 hover:bg-hover")}>{onEdit ? t("routineCalendar.botInstructions") : t("routineEditor.none")}</p>;
  return <div className="min-w-0">
    <div ref={body} data-routine-instruction-text data-folded={!open && long ? "" : undefined} {...editProps} className={cn("relative min-w-0 break-words text-[13.5px] leading-relaxed text-ink [&_a]:no-underline", !open && (short ? "max-h-[7.5rem] overflow-hidden" : "max-h-[35vh] overflow-hidden"), onEdit && "-mx-2 cursor-text rounded-lg px-2 py-1 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}>
      <ChatMarkdown text={text} />
      {!open && long && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-panel to-transparent" />}
    </div>
    {(long || open) && <button type="button" data-routine-instruction-more onClick={() => setOpen((value) => !value)} className={cn(PANEL_TEXT_ACTION, "-ml-1.5 mt-1")}>{open ? t("routineEditor.showLess") : t("routineEditor.showMore")}</button>}
  </div>;
}

/** The request Format with AI puts in the bot's composer, not sent. */
export function formatWithAiRequest(routine: Pick<Routine, "id" | "name">): string {
  return t("routineEditor.formatAiPrompt", { name: routine.name, id: routine.id });
}

/** "Format with AI" (2026-11-03, JC): opens the routine owner's bot chat and
 * fills its composer with the request, without sending it. The person reads
 * it and presses Enter; the bot then rewrites the instruction and saves it
 * through its routine edit tool (propose_routine_action), under the bot's
 * own approval mode. Nothing here closes. */
export function FormatWithAiButton({ bot, routine }: { bot: Bot; routine: Routine }) {
  const { dispatch } = useStore();
  const threadsShown = useShowThreads();
  const open = () => {
    const threadId = bot.threadId;
    openBotThread(dispatch, bot, threadId, threadsShown);
    appendComposerDraft(`bot:${bot.id}:${threadId}`, formatWithAiRequest(routine));
    // The chat mounts its composer first; then the caret goes at its end.
    requestAnimationFrame(() => { if (!focusComposer()) setTimeout(() => focusComposer(), 120); });
  };
  return <button type="button" data-routine-format-ai onClick={open} title={t("routineEditor.formatAiHint", { bot: bot.name })}
    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
    <Sparkles size={12} aria-hidden="true" />{t("routineEditor.formatAi")}
  </button>;
}
