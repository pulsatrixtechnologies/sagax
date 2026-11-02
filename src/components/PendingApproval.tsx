// Pending approval, ported from the upstream pattern: an approval does
// not sit in the transcript waiting to be noticed — it takes over the
// composer. The prompt is disabled, a strip above it says exactly what
// is being asked, and the send row is replaced by the decisions.
//
// Faithful details worth keeping: one at a time with an "n of N" counter,
// the detail printed raw in a monospace block that is NEVER truncated
// (it scrolls instead), and the buttons ordered least-destructive-last so
// the primary action sits under your thumb.
import { memo, useState } from "react";
import { Bot as BotIcon, ChevronDown, ChevronLeft, ChevronRight, GitFork } from "lucide-react";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { adminWillAnswerLine, toolApprovalView, toolLabel } from "./ApprovalCard";
import { ApprovalHeading, TechnicalDetails } from "./ApprovalParts";
import { describeApproval, isTechnicalText } from "@/lib/approval-describe";
import { reviewedSkillSha256 } from "../../shared/skill-request";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useOrgApprovalPolicy } from "@/lib/org-approval-policy";
import { CustomRuleNoticeLine, riskList } from "./CustomRuleNotice";
import { customRuleError } from "./bot-settings/CustomRulesCard";
import { recipientKeysForSendCard } from "../../shared/send-card-recipients";
import { parseRecipientEntry } from "../../shared/allowed-recipients";
import { readableError } from "@/lib/plain-error";

interface ApprovalLabels {
  [tool: string]: LocaleKey;
}

export interface Pending {
  message: Message;
  requestId: string;
  tool: string;
  /** the narrow grant "always allow" writes, computed server-side */
  allowKey?: string;
  allowSession?: boolean;
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  detail: string;
  held?: string;
  heldCode?: string;
  /** Asked by a parallel task of this conversation (shared/parallel-tasks.ts):
   * its own thread, where the answer goes, and its name for the card. */
  threadId?: string;
  parallelTitle?: string;
  /** A bot-to-bot conversation's card (WireBot.waitingApprovals): the bot
   * that asked ("" when its name is unknown). */
  askedBy?: string;
}

/** The persisted payload is the authoritative marker. Tool names are
 * provider-authored display strings and can collide with ours. */
const HELD_SILENT = new Set(["approval.held.native", "approval.held.gate"]);

export function isRoutineApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.routineRequest);
}

export function isSkillApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.skillRequest);
}

export function isProfileApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.profileRequest);
}

export function isRuleApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.ruleRequest);
}

/** Open approvals on a thread, oldest first — answered/dismissed drop out. */
export function pendingApprovals(messages: Message[]): Pending[] {
  return messages
    // An expired proposal is terminal: it must not take over the composer
    // or offer its decision buttons anywhere.
    // A meeting's consent card is answered on the card itself, in the chat
    // (MeetingCard), never from the composer's approval stepper.
    .filter((m) => m.kind === "options" && m.card?.requestId && m.card.tool && !m.card.meetingRequest && !m.card.answered && !m.card.dismissed && !m.card.expired)
    .map((m) => ({
      message: m,
      requestId: m.card!.requestId!,
      tool: m.card!.tool!,
      allowKey: m.card!.allowKey,
      allowSession: m.card!.allowSession,
      commandAllowlist: m.card!.commandAllowlist,
      detail: m.card!.subtitle,
      held: m.card!.held,
      heldCode: m.card!.heldCode,
    }));
}

/** Routine cards can carry every instruction the user asked for (up to
 * 20,000 characters). Calls should announce the concise, visible title and
 * let the user review those details on screen instead of reading them all. */
export function spokenApprovalPrompt(pending: Pending, requester: string): string {
  if (pending.message.card?.teamSetupRequest) return `${requester}: ${pending.message.card.title} Review the details and choose ${pending.message.card.options[0]} or ${pending.message.card.options[1] ?? "Cancel"}.`;
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  const isRuleRequest = isRuleApproval(pending);
  if (isSkillRequest) {
    const updating = pending.message.card?.skillRequest?.action === "update";
    const title = pending.message.card?.title.trim() || t(
      updating ? "approval.voice.defaultUpdateSkill" : "approval.voice.defaultEnableSkill",
    );
    return t("approval.voice.skill", {
      requester,
      title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
      action: t(updating ? "approval.voice.actionUpdate" : "approval.voice.actionEnable"),
    });
  }
  if (isProfileRequest) {
    // pending.detail is the full subtitle — the whole diff for a soul
    // change. Speak the card's concise title instead, the same way the
    // routine/skill branches do, and let the user read the diff on screen.
    const title = pending.message.card?.title.trim() || t("approval.voice.defaultUpdateProfile");
    return t("approval.voice.profile", { requester, title });
  }
  if (isRuleRequest) {
    const title = pending.message.card?.title.trim() || t("approval.voice.defaultUpdateRule");
    return t("approval.voice.rule", { requester, title });
  }
  if (!isRoutineRequest) {
    // pending.tool can be an ACP toolCall kind rather than a tool name —
    // speak the same verb phrase the card header shows, so voice never
    // reads "wants to other".
    // Raw JSON arguments are not read aloud: the plain summary is.
    const card = pending.message.card;
    const input = card?.toolInput ?? pending.detail;
    const tool = toolLabel(pending.tool, input, card?.toolHints);
    const detail = isTechnicalText(pending.detail)
      ? describeApproval(pending.tool, input, card?.toolHints).summary
      : pending.detail;
    // asked as a question with its two options; the spoken answer must pick
    // one (src/lib/voice-mode/answers.ts). Always allow is never offered by
    // voice: it widens a grant and stays a tap on the card.
    return detail?.trim()
      ? t("approval.voice.commandAsk", { requester, tool, detail })
      : t("approval.voice.commandNoDetailAsk", { requester, tool });
  }
  const title = pending.message.card?.title.trim() || t("approval.voice.defaultConfirmRoutine");
  return t("approval.voice.routine", {
    requester,
    title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
  });
}

function label(pending: Pending): string {
  if (pending.message.card?.teamSetupRequest) return pending.message.card.title;
  if (isSkillApproval(pending)) {
    return pending.message.card?.skillRequest?.action === "update"
      ? t("approval.label.updateSkill")
      : t("approval.label.enableSkill");
  }
  if (isProfileApproval(pending)) {
    return t("approval.label.confirmProfileChange");
  }
  if (isRuleApproval(pending)) {
    return t("approval.label.confirmRuleChange");
  }
  if (isRoutineApproval(pending)) {
    return pending.message.card?.routineRequest?.operation.action === "create"
      ? t("approval.label.confirmRoutine")
      : t("approval.label.confirmRoutineChange");
  }
  const nice: ApprovalLabels = {
    Bash: "approval.label.commandRequested",
    shell: "approval.label.commandRequested",
    Read: "approval.label.fileReadRequested",
    Write: "approval.label.fileChangeRequested",
    Edit: "approval.label.fileChangeRequested",
    edit: "approval.label.fileChangeRequested",
  };
  const key = nice[pending.tool];
  return key ? t(key) : t("approval.label.requested");
}

/** The pending tool approvals that only read data: the stepper's "Allow
 * all" covers these and nothing else (never a proposal, a write, or a
 * command waiting for an organization admin). */
export function readOnlyApprovals(approvals: Pending[]): Pending[] {
  return approvals.filter((pending) => {
    const card = pending.message.card;
    if (!card || card.adminApproval) return false;
    if (card.routineRequest || card.skillRequest || card.profileRequest || card.ruleRequest || card.teamSetupRequest || card.questionRequest || card.terminalRequest || card.meetingRequest) return false;
    return describeApproval(pending.tool, card.toolInput ?? card.subtitle, card.toolHints).risk === "read";
  });
}

/** Which of several pending approvals is on screen: the one picked by id,
 * else the oldest. Following the id (not a number) keeps the same request
 * in view when another one is answered and leaves the list. */
export function stepperIndex(approvals: Pending[], requestId: string | undefined): number {
  const at = requestId ? approvals.findIndex((pending) => pending.requestId === requestId) : -1;
  return at >= 0 ? at : 0;
}

function Stepper({ index, count, onPrevious, onNext }: { index: number; count: number; onPrevious?: () => void; onNext?: () => void }) {
  const button = "flex size-6 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-0.5" data-approval-stepper="">
      <button type="button" onClick={onPrevious} disabled={!onPrevious || index === 0} aria-label={t("approval.stepper.previous")} className={button}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span className="min-w-[3.5em] text-center text-[12px] tabular-nums text-ink-secondary" aria-live="polite">
        {t("approval.position", { index: index + 1, count })}
      </span>
      <button type="button" onClick={onNext} disabled={!onNext || index >= count - 1} aria-label={t("approval.stepper.next")} className={button}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export const PendingApprovalPanel = memo(function PendingApprovalPanel({
  pending,
  count,
  index,
  bot,
  onPrevious,
  onNext,
  allowAllReadOnly,
}: {
  pending: Pending;
  count: number;
  index: number;
  /** who asks, for the avatar and the "Name wants to" title */
  bot?: Bot;
  onPrevious?: () => void;
  onNext?: () => void;
  /** several read-only requests wait: allow them all at once */
  allowAllReadOnly?: { count: number; onAllow: () => void };
  /** The active locale. Not read here: it is the memo key, the same way the
   * transcript takes one. Every line in this panel comes from the catalog,
   * and nothing else about a pending approval changes with the language. */
  locale?: string;
}) {
  // Held note (issue #426): one quiet line. The provider's own note and the
  // routine gate's say nothing the title does not, so they are never shown;
  // the others (outbound, sandbox, safety, undelivered, the person's own
  // rule) say why this waits.
  const heldNote = pending.heldCode && HELD_SILENT.has(pending.heldCode) ? undefined : tFromServer(pending.heldCode, pending.held);
  const card = pending.message.card;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const proposal = isSkillApproval(pending) || isRoutineApproval(pending) || isProfileApproval(pending) || isRuleApproval(pending) || Boolean(card?.teamSetupRequest);
  const view = !proposal && card ? toolApprovalView(card, bot?.name) : undefined;
  // never truncated: long commands wrap and scroll
  const visibleText = proposal ? pending.detail : pending.commandAllowlist?.command ?? view?.plain;
  return (
    <div
      role="region"
      aria-label={
        isSkillApproval(pending)
          ? t("approval.aria.pendingSkill")
          : isRoutineApproval(pending)
            ? t("approval.aria.pendingRoutine")
            : isProfileApproval(pending)
              ? t("approval.aria.pendingProfile")
              : isRuleApproval(pending)
                ? t("approval.aria.pendingRule")
              : t("approval.aria.pending")
      }
      className="px-4 pt-3"
    >
      {pending.askedBy !== undefined && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-secondary" data-approval-asked-by={pending.threadId}>
          <BotIcon size={12} aria-hidden="true" />
          <span className="truncate">{pending.askedBy ? t("approval.askedByBot", { name: pending.askedBy }) : t("approval.askedByOtherBot")}</span>
        </div>
      )}
      {pending.parallelTitle && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-secondary" data-approval-parallel={pending.threadId}>
          <GitFork size={12} aria-hidden="true" />
          <span className="truncate">{t("approval.parallelTask", { title: pending.parallelTitle })}</span>
        </div>
      )}
      <ApprovalHeading
        bot={bot}
        title={<span aria-live="polite">{view ? view.title : label(pending)}</span>}
        summary={view?.summary}
        risk={view?.risk}
        aside={count > 1 ? (
          <div className="flex flex-col items-end gap-0.5">
            <Stepper index={index} count={count} onPrevious={onPrevious} onNext={onNext} />
            {allowAllReadOnly && allowAllReadOnly.count > 1 && (
              <button
                type="button"
                onClick={allowAllReadOnly.onAllow}
                title={t("approval.action.allowAllReadOnlyHint")}
                className="rounded-md px-1 text-[12px] font-medium text-accent hover:underline"
              >
                {t("approval.action.allowAllReadOnly", { count: allowAllReadOnly.count })}
              </button>
            )}
          </div>
        ) : undefined}
      />
      {!proposal && (visibleText || view?.args || pending.tool) && (
        // 2026-10-20 (after the reference design): one short line of what runs, the
        // rest folded under Details
        <div className="mt-1.5" data-approval-preview={detailsOpen ? "open" : "closed"}>
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-label={t("approval.aria.reviewDetails")}
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-lg bg-inset px-2.5 py-1.5 text-left text-[12px] text-ink-secondary hover:text-ink"
          >
            <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 transition-transform", detailsOpen ? "rotate-0" : "-rotate-90")} />
            {visibleText && !detailsOpen
              ? <code className="min-w-0 flex-1 truncate font-mono text-ink" title={visibleText}>{visibleText.replace(/\s+/g, " ")}</code>
              : <span className="flex-1">{t("approval.details.more")}</span>}
          </button>
          {detailsOpen && (
            <>
              {visibleText && (
                <pre
                  tabIndex={0}
                  aria-label={t("approval.aria.reviewDetails")}
                  className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
                >
                  {visibleText}
                </pre>
              )}
              {view && (view.args || pending.tool) && (
                <TechnicalDetails key={pending.requestId} tool={pending.tool} server={view.server} args={view.args} argsLabel={t("approval.aria.reviewDetails")} defaultOpen />
              )}
            </>
          )}
        </div>
      )}
      {proposal && visibleText && (
        <pre
          tabIndex={0}
          aria-label={
            isSkillApproval(pending)
              ? t("approval.aria.reviewSkill")
              : isRoutineApproval(pending)
                ? t("approval.aria.reviewRoutine")
                : isProfileApproval(pending)
                  ? t("approval.aria.reviewProfile")
                  : isRuleApproval(pending)
                    ? t("approval.aria.reviewRule")
                  : t("approval.aria.reviewDetails")
          }
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
        >
          {visibleText}
        </pre>
      )}
      {card?.skillRequest && <SkillRequestPreview request={card.skillRequest} />}
      {heldNote && <div className="mt-2 text-[12px] text-ink-secondary" data-approval-held>{heldNote}</div>}
      {card?.reviewing && !card.answered && (
        <div data-auto-review="pending" className="mt-2 text-[12.5px] text-ink-secondary">{t("customRules.notice.reviewing")}</div>
      )}
      {card?.customRule && <CustomRuleNoticeLine notice={card.customRule} botId={bot?.id} />}
    </div>
  );
});

export function PendingApprovalActions({
  pending,
  threadId,
  bot,
  onCancelTurn,
  variant = "composer",
  onDecided,
  onDecideFailed,
}: {
  pending: Pending;
  threadId: string;
  /** who asked — "always allow" is remembered against them */
  bot?: Bot;
  onCancelTurn: () => void;
  /** "inbox": the Approvals screen's large Yes / No, the same answers and
   * the same remembered grants as the composer's row */
  variant?: "composer" | "inbox";
  /** told once an answer was sent (the Approvals screen shows what follows) */
  onDecided?: (behavior: "allow" | "deny") => void;
  /** the server refused that answer (a 403, a 409): undo what onDecided showed */
  onDecideFailed?: () => void;
}) {
  const { dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  // 2026-10-21: the organization may keep every approval to one card
  // (server/custom-rules-org.ts): no Always allow, and the card says why
  const orgPolicy = useOrgApprovalPolicy();
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  const isRuleRequest = isRuleApproval(pending);
  const isTeamSetup = Boolean(pending.message.card?.teamSetupRequest);
  const isSuggestion = Boolean(pending.message.card?.teamSetupRequest?.suggestion);
  const durableRequest = isRoutineRequest || isSkillRequest || isProfileRequest || isRuleRequest || isTeamSetup;
  // 2026-10-14: the owner's own rule this card can remember (Always allow /
  // Always deny), which replaces the older per-bot grants on the card.
  // 2026-10-19 ("Toujours permettre" on every card): an admin's card
  // offers it too, to the admin who answers it (Always allow only).
  const ownerRule = pending.message.card?.ownerRule;
  // 2026-10-20 : the card offers Deny, Always allow and Allow once
  // only; Always deny and the detailed editor live in Settings > Security.
  const canRememberCommand = ownerOrAdmin === true && !durableRequest && !ownerRule && !pending.allowKey && Boolean(pending.commandAllowlist);
  const reviewedSha256 = pending.message.card?.skillRequest
    ? reviewedSkillSha256(pending.message.card.skillRequest)
    : undefined;
  // "Toujours permettre ceci": a custom rule in the person's words, saved
  // from this card, then this request allowed (2026-10-16)
  const candidate = !durableRequest && !pending.message.card?.adminApproval ? pending.message.card?.customRuleCandidate : undefined;
  const decide = (behavior: "allow" | "deny", always = false, rememberCommand = false, rule?: "allow" | "deny", ruleScope?: "folder") => {
    onDecided?.(behavior);
    dispatch({
      type: "decideRequest",
      threadId: pending.threadId ?? threadId,
      requestId: pending.requestId,
      behavior,
      message: behavior === "deny" ? "Denied by the user." : undefined,
      reviewedSha256: behavior === "allow" ? reviewedSha256 : undefined,
      // a harness-native card (peer comms) remembers a grant on the bot; a
      // provider's card hands the allow to the provider for its session
      alwaysAllow: always && bot && pending.allowKey ? { botId: bot.id, key: pending.allowKey } : undefined,
      always: always && !pending.allowKey && pending.allowSession ? true : undefined,
      rememberCommand: rememberCommand || undefined,
      rule,
      ...(ruleScope ? { ruleScope } : {}),
      ...(onDecideFailed ? { onError: () => onDecideFailed() } : {}),
    });
  };

  const base = "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors";
  const secondary = cn(base, "border border-hairline/50 text-ink hover:bg-control");
  // "Cancel turn" stops the whole reply: a quiet link, away from the answers
  const quiet = "rounded-md px-1 py-1 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline";
  // Organization server: a command on the server asked by a member's bot
  // waits for an organization admin; its owner can only stop the turn.
  if (pending.message.card?.adminApproval && ownerOrAdmin !== true) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-2">
        <button type="button" onClick={onCancelTurn} className={quiet}>
          {t("approval.action.cancelTurn")}
        </button>
        <span role="status" className="flex min-w-0 flex-col text-[12.5px] text-ink-secondary">
          <span>{t("approval.waitingForAdmin")}</span>
          <span>{adminWillAnswerLine(pending.message.card.adminNames)}</span>
          <span data-admin-delegate="">{t("approval.adminDelegate")}</span>
        </span>
      </div>
    );
  }
  const allowLabel = isTeamSetup ? pending.message.card?.options[0] : isSkillRequest
    ? pending.message.card?.skillRequest?.action === "update"
      ? t("approval.action.update")
      : t("approval.action.enable")
    : isRoutineRequest || isProfileRequest || isRuleRequest
      ? t("approval.action.confirm")
      : t("approval.action.allowOnce");
  const denyLabel = isSuggestion ? t("approval.action.notNow") : isRoutineRequest || isProfileRequest || isRuleRequest || isTeamSetup ? t("approval.action.cancel") : t("approval.action.deny");
  // 2026-10-20 (after the reference design): one "Always allow", one click. It
  // keeps the card's default rule (this bot, this kind of action or this
  // program, never a second panel), answers this request and closes the
  // card. The detailed rule editor lives in Settings > Security only.
  // A send card's Always allow adds the recipient to this bot's list
  // (shared/allowed-recipients.ts), instead of a wider rule.
  const recipientKeys = !durableRequest && orgPolicy.alwaysAllow && bot
    ? recipientKeysForSendCard(pending.message.card)
    : null;
  const alwaysAllow: { run: () => void; hint?: string } | undefined = ownerRule
    ? { run: () => decide("allow", false, false, "allow"), hint: t("approval.action.alwaysAllowRuleHint", { name: bot?.name ?? t("approval.someone"), rule: ownerRule.description }) }
    : durableRequest ? undefined
      : bot && pending.allowKey ? { run: () => decide("allow", true), hint: t("approval.action.stopAsking", { name: bot.name, key: pending.allowKey }) }
        : canRememberCommand && pending.commandAllowlist ? { run: () => decide("allow", false, true), hint: t("approval.action.alwaysAllowCommandHint", { cwd: pending.commandAllowlist.cwd }) }
          : undefined;
  // 2026-10-26 (#1065): a card of a file or a folder offers two choices,
  // this file (the exact path) and the whole folder (and its subfolders)
  const ownerRuleFolder = ownerRule && !durableRequest ? pending.message.card?.ownerRuleFolder : undefined;
  const widening = !orgPolicy.alwaysAllow && !durableRequest ? (
    <span className="text-[11.5px] text-ink-tertiary" data-org-always-allow-off="">{t("approval.orgOnce")}</span>
  ) : recipientKeys && bot ? (
    <AlwaysAllowRecipients
      bot={bot}
      keys={recipientKeys}
      className={secondary}
      onSaved={() => decide("allow")}
    />
  ) : alwaysAllow && ownerRuleFolder ? (
    <>
      <button
        type="button"
        onClick={alwaysAllow.run}
        title={alwaysAllow.hint}
        className={secondary}
        data-always-allow=""
        data-owner-rule="allow"
      >
        {t(ownerRuleFolder.writes ? "approval.action.alwaysAllowFileWrite" : "approval.action.alwaysAllowFile")}
      </button>
      <button
        type="button"
        onClick={() => decide("allow", false, false, "allow", "folder")}
        title={t("approval.action.alwaysAllowRuleHint", { name: bot?.name ?? t("approval.someone"), rule: ownerRuleFolder.description })}
        className={secondary}
        data-always-allow-folder=""
        data-owner-rule="allow"
      >
        {t(ownerRuleFolder.writes ? "approval.action.alwaysAllowFolderWrite" : "approval.action.alwaysAllowFolder")}
      </button>
    </>
  ) : alwaysAllow ? (
    <button
      type="button"
      onClick={alwaysAllow.run}
      disabled={isSkillRequest && !reviewedSha256}
      title={alwaysAllow.hint}
      className={cn(secondary, "disabled:cursor-not-allowed disabled:opacity-40")}
      data-always-allow=""
      {...(ownerRule ? { "data-owner-rule": "allow" } : {})}
    >
      {t("approval.action.alwaysAllow")}
    </button>
  ) : !durableRequest && candidate && bot ? (
    // never without the bot: the rule would silently become one for all bots
    <AlwaysAllowCandidate
      candidate={candidate}
      bot={bot}
      threadId={pending.threadId ?? threadId}
      requestId={pending.requestId}
      className={secondary}
      onSaved={() => decide("allow")}
    />
  ) : !durableRequest && pending.allowSession ? (
    <button type="button" onClick={() => decide("allow", true)} title={t("approval.action.alwaysAllowSessionHint")} className={secondary} data-always-allow="">
      {t("approval.action.alwaysAllow")}
    </button>
  ) : null;
  // 2026-10-21 (parité R10, ligne 80): a screen action on the person's own
  // computer whose app the server read says which app, and what Always
  // allow then covers ("Katarina peut voir Safari, y cliquer et y saisir du
  // texte sur cet ordinateur").
  const computerApp = ownerRule?.tool === "computer_app" && typeof ownerRule.scope?.app === "string" ? ownerRule.scope.app : null;
  const appLine = computerApp ? (
    <span className="min-w-0 text-[12.5px] leading-5 text-ink-secondary" data-computer-app="">
      {t("approval.computerApp.line", { name: bot?.name ?? t("approval.someone"), app: computerApp })}
    </span>
  ) : null;
  // 2026-10-22: why a card still shows although the bot is on auto mode and
  // has rules — a risky action (a deletion, an external send, a payment) no
  // rule covers. Name the risk type in human terms; "Toujours permettre"
  // (the candidate button below) authors a correctly scoped rule that covers
  // it. Not shown when a rule notice already explains (card.customRule), nor
  // on the owner-rule path.
  const riskHint = candidate && candidate.risks.length > 0 && !ownerRule && !pending.message.card?.customRule ? (
    <span className="basis-full min-w-0 text-[12.5px] leading-5 text-ink-secondary" data-approval-risk-hint="">
      {t("approval.whyRisk", { kinds: riskList(candidate.risks) })}
    </span>
  ) : null;
  if (variant === "inbox") {
    // Yes and No side by side, as large as the panel allows: green allows
    // exactly what the card shows, red declines it. The grants that last
    // longer stay smaller underneath, so the big buttons only ever mean once.
    const big = "flex min-h-14 flex-1 flex-col items-center justify-center rounded-2xl px-4 py-2.5 transition-[filter,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40";
    return (
      <div className="flex flex-col gap-3 px-5 pb-5 pt-3" data-approval-actions="inbox">
        {appLine}
        {riskHint}
        <div className="flex gap-3">
          <button
            type="button"
            data-decision="deny"
            aria-keyshortcuts="N"
            onClick={() => decide("deny")}
            className={cn(big, "bg-danger text-danger-ink hover:brightness-110 focus-visible:ring-danger/60")}
          >
            <span className="flex items-center gap-2 text-[17px] font-semibold leading-6">
              {t("approvals.no")}
              <kbd className="rounded-md bg-black/15 px-1.5 text-[11px] font-medium leading-5">N</kbd>
            </span>
            <span className="text-[12px] leading-4 opacity-90">{denyLabel}</span>
          </button>
          <button
            type="button"
            data-decision="allow"
            aria-keyshortcuts="Y"
            onClick={() => decide("allow")}
            disabled={isSkillRequest && !reviewedSha256}
            className={cn(big, "bg-success hover:brightness-110 focus-visible:ring-success/60")}
          >
            <span className="flex items-center gap-2 text-[17px] font-semibold leading-6">
              {t("approvals.yes")}
              <kbd className="rounded-md bg-black/15 px-1.5 text-[11px] font-medium leading-5">Y</kbd>
            </span>
            <span className="text-[12px] leading-4 opacity-90">{allowLabel}</span>
          </button>
        </div>
        {widening && <div className="flex flex-wrap items-center gap-2">{widening}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2">
      {appLine}
      {riskHint}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => decide("deny")}
          autoFocus={isTeamSetup}
          className={cn(base, "border border-danger/40 text-danger hover:bg-danger/10")}
        >
          {denyLabel}
        </button>
        {widening}
        <button
          type="button"
          onClick={() => decide("allow")}
          disabled={isSkillRequest && !reviewedSha256}
          className={cn(
            base,
            "bg-accent font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {allowLabel}
        </button>
      </div>
    </div>
  );
}

/** "Toujours permettre" on a send card: the recipients join this bot's
 * allowed list, then this request is allowed once. The list screen is not
 * redrawn here. */
function AlwaysAllowRecipients({ bot, keys, className, onSaved }: {
  bot: Bot;
  keys: string[];
  className: string;
  onSaved: () => void;
}) {
  const store = useStore();
  const dispatch = store.dispatch;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bots = store.state?.bots ?? [];
  const names = keys.map((key) => {
    const entry = parseRecipientEntry(key);
    if (!entry) return key;
    if (entry.kind !== "bot") return entry.value;
    return bots.find((candidate) => candidate.id === entry.value)?.name ?? t("botPanel.recipients.deletedBot");
  }).join(", ");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={t("approval.recipients.alwaysHint", { names })}
        className={cn(className, "disabled:opacity-40")}
        data-always-allow=""
        data-always-allow-recipient=""
        onClick={() => {
          const current = bot.allowedRecipients ?? [];
          const next = [...current];
          for (const key of keys) if (!next.includes(key)) next.push(key);
          if (next.length === current.length) {
            onSaved();
            return;
          }
          setBusy(true);
          setError(null);
          void api<{ bot: Bot }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ allowedRecipients: next }),
          })
            .then((response) => {
              dispatch({ type: "botPatched", bot: response.bot });
              onSaved();
            })
            .catch((failure: unknown) => setError(readableError(failure)))
            .finally(() => setBusy(false));
        }}
      >
        {t("approval.action.alwaysAllow")}
      </button>
      {error && <div role="alert" className="order-last w-full basis-full text-[12px] text-danger">{error}</div>}
    </>
  );
}

/** "Always allow" for a card whose rule is the person's own words (a custom
 * rule the server proposed, 2026-10-16): one click saves it for this bot,
 * as proposed, then answers this request. No editor on the card
 * (2026-10-20): the rule can be changed in Settings > Security. */
function AlwaysAllowCandidate({ candidate, bot, threadId, requestId, className, onSaved }: {
  candidate: NonNullable<NonNullable<Message["card"]>["customRuleCandidate"]>;
  bot: Bot;
  threadId: string;
  requestId: string;
  className: string;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={t("customRules.alwaysAllowThisHint", { name: bot.name })}
        className={cn(className, "disabled:opacity-40")}
        data-always-allow=""
        onClick={() => {
          setBusy(true);
          setError(null);
          void api("/api/custom-rules", {
            method: "POST",
            body: JSON.stringify({ when: candidate.when, behavior: "allow", botId: bot.id, riskScope: candidate.risks, fromCard: { threadId, requestId } }),
          })
            .then(() => onSaved())
            .catch((failure: unknown) => setError(customRuleError(failure)))
            .finally(() => setBusy(false));
        }}
      >
        {t("approval.action.alwaysAllow")}
      </button>
      {error && <div role="alert" className="order-last w-full basis-full text-[12px] text-danger">{error}</div>}
    </>
  );
}

/** The composer's approval box: one request at a time, a "1 of 2"
 * stepper when several wait, and the decisions under it. */
export function PendingApprovalBox({
  approvals,
  threadId,
  botFor,
  onCancelTurn,
  locale,
  initialRequestId,
}: {
  approvals: Pending[];
  threadId: string;
  botFor: (pending: Pending) => Bot | undefined;
  onCancelTurn: () => void;
  locale?: string;
  initialRequestId?: string;
}) {
  const { dispatch } = useStore();
  const [requestId, setRequestId] = useState<string | undefined>(initialRequestId);
  const index = stepperIndex(approvals, requestId);
  const pending = approvals[index];
  if (!pending) return null;
  const readOnly = readOnlyApprovals(approvals);
  const go = (to: number) => setRequestId(approvals[to]?.requestId);
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-accent/40 bg-card">
      {/* locale: the panel is memoized and its other props do not
          change with the language (see MessagesList in ChatView) */}
      <PendingApprovalPanel
        key={pending.requestId}
        pending={pending}
        count={approvals.length}
        index={index}
        bot={botFor(pending)}
        onPrevious={index > 0 ? () => go(index - 1) : undefined}
        onNext={index < approvals.length - 1 ? () => go(index + 1) : undefined}
        locale={locale}
        allowAllReadOnly={readOnly.length > 1
          ? {
              count: readOnly.length,
              onAllow: () => {
                for (const each of readOnly) dispatch({ type: "decideRequest", threadId: each.threadId ?? threadId, requestId: each.requestId, behavior: "allow" });
              },
            }
          : undefined}
      />
      <PendingApprovalActions
        key={pending.requestId}
        pending={pending}
        threadId={threadId}
        bot={botFor(pending)}
        // a parallel task's "cancel" stops that task, a bot-to-bot
        // conversation's stops that conversation's turn, never this one's
        onCancelTurn={pending.threadId && pending.threadId !== threadId && botFor(pending)
          ? pending.askedBy !== undefined
            ? () => dispatch({ type: "interrupt", botId: botFor(pending)!.id, threadId: pending.threadId! })
            : () => dispatch({ type: "stopParallelTask", botId: botFor(pending)!.id, threadId: pending.threadId! })
          : onCancelTurn}
      />
    </div>
  );
}
