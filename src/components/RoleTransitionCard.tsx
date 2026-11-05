// Visible roles (2026-11-05): the inline "Agit comme" card at a role
// transition, in the approval card family (the question sheet). It says who
// switches from which role to which, why (a read refused with 403, or the
// bot's own switch), and on whose behalf ("au nom de <person>"). Continue
// keeps going; Stay puts the thread back in the previous role with no more
// fallback from it; Always (the bot's owner) saves a plain rule on the bot's
// Permissions page. Answered through its own route, never as a typed reply.
import { useState } from "react";
import { t } from "@/lib/i18n";
import { api, type Message } from "@/state/store";
import { QuestionSheet, SheetChoices, SheetNote, sheetKeyHandler, type SheetChoice } from "./QuestionSheet";
import { roleLabel } from "./RoleChip";
import { stepToolName } from "@/lib/step-label";
import type { RoleTransitionCard as RoleTransitionData } from "../../shared/wire";

type Choice = NonNullable<RoleTransitionData["choice"]>;

/** The card's sentence in the reader's language. */
export function roleTransitionText(card: RoleTransitionData): string {
  const from = roleLabel(card.from);
  const to = roleLabel(card.to);
  const person = card.person?.trim() || t("roles.me");
  const bot = card.botName?.trim() || t("ids.deletedBot");
  if (card.reason === "fallback") {
    // the refused thing in words: its CW path when known, else the tool
    const tool = card.path ? `« ${card.path} »` : card.refusedTool ? stepToolName({ name: card.refusedTool }) : "";
    return t("roles.transition.fallback", { bot, from, to, tool, person });
  }
  return t("roles.transition.switch", { bot, from, to, person });
}

export function RoleTransitionCard({ message, threadId }: { message: Message; threadId?: string }) {
  const card = message.card;
  const transition = card?.roleTransition;
  const [sending, setSending] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!card || !transition) return null;
  const from = roleLabel(transition.from);
  const to = roleLabel(transition.to);
  const choices: Array<SheetChoice & { id: Choice }> = [
    { id: "continue", label: t("roles.transition.continue") },
    { id: "stay", label: t("roles.transition.stay", { role: from }) },
    ...(transition.canAlways ? [{ id: "always" as const, label: t("roles.transition.always") }] : []),
  ];
  const settled = Boolean(card.answered || transition.choice);
  const answered = transition.choice;
  const pick = (id: string) => {
    if (settled || sending || !threadId) return;
    const choice = id as Choice;
    setSending(choice);
    setError(null);
    api(`/api/bots/${transition.botId}/cards/${message.id}/role-transition`, { method: "POST", body: JSON.stringify({ threadId, choice }) })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setSending(null));
  };
  const title = t("roles.transition.title", { role: to });
  return (
    <div data-role-transition-card="" data-reason={transition.reason} data-choice={answered}>
      <QuestionSheet
        ariaLabel={title}
        title={title}
        settled={settled}
        onKeyDown={settled ? undefined : sheetKeyHandler(choices.length, (index) => pick(choices[index]!.id))}
      >
        <p className="-mt-1 mb-2.5 text-[13px] leading-snug text-ink-secondary" data-role-transition-text="">{roleTransitionText(transition)}</p>
        <SheetChoices
          choices={choices}
          picked={answered ? [answered] : sending ? [sending] : []}
          settled={settled}
          disabled={Boolean(sending)}
          ariaLabel={title}
          onPick={pick}
        />
        {answered && (
          <SheetNote>
            {answered === "continue" ? t("roles.transition.answered.continue") : answered === "stay" ? t("roles.transition.answered.stay", { role: from }) : t("roles.transition.answered.always")}
          </SheetNote>
        )}
        {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      </QuestionSheet>
    </div>
  );
}
