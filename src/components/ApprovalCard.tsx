// The approval box: what the bot wants to do, and three ways to answer.
//
// Deliberately not the lettered A/B/C list the onboarding card uses — an
// approval is a decision about one concrete action, so it shows the tool
// and the actual command/path in monospace, and the choices carry their
// own behavior instead of being matched by their label text.
import { useState } from "react";
import { Check, ShieldCheck, Undo2, X } from "lucide-react";
import { api, ApiError, useStore, type Bot, type Message, type OptionCardData } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { ApprovalHeading, TechnicalDetails } from "@/components/ApprovalParts";
import { StepRow } from "@/components/StepRow";
import { CustomRuleNoticeLine, CustomRuleSavedInset, customRuleNoticeLine } from "@/components/CustomRuleNotice";
import { readStep } from "@/lib/step-label";
import { approvalPlain, describeAllowRule, describeApproval, isTechnicalText, parseToolId, type ApprovalRisk, type ToolHints } from "@/lib/approval-describe";
import { outboundSummary } from "@/lib/approval-summary";
import { cronLocale, niceDate, niceTime, scheduleLabel } from "@/lib/schedule-label";
import { cronIsDescribed, cronScheduleLabel } from "../../shared/cron-label";
import { PROFILE_REQUEST_FIELDS, type ProfileRequestField } from "../../shared/profile-request";
import type { RoutineRequestSchedule } from "../../shared/routine-request";
import { readableError } from "@/lib/plain-error";

interface ToolLabels {
  [tool: string]: LocaleKey;
}

const ROUTINE_SETTLED_LABEL = {
  create: "approval.status.routineScheduled",
  update: "approval.status.routineUpdated",
  pause: "approval.status.routinePaused",
  resume: "approval.status.routineResumed",
  run_now: "approval.status.routineRunQueued",
  delete: "approval.status.routineDeleted",
} as const;

const SKILL_SETTLED_LABEL = {
  create: "approval.status.skillEnabled",
  update: "approval.status.skillUpdated",
} as const;

const ROUTINE_APPLIED_LINE = {
  create: "approval.applied.routine.create",
  update: "approval.applied.routine.update",
  pause: "approval.applied.routine.pause",
  resume: "approval.applied.routine.resume",
  run_now: "approval.applied.routine.runNow",
  delete: "approval.applied.routine.delete",
} as const;

const SKILL_APPLIED_LINE = {
  create: "approval.applied.skill.create",
  update: "approval.applied.skill.update",
} as const;

const PROFILE_FIELD_LABEL: Record<ProfileRequestField, LocaleKey> = {
  name: "approval.applied.field.name",
  title: "approval.applied.field.title",
  description: "approval.applied.field.description",
  soul: "approval.applied.field.soul",
  cwd: "approval.applied.field.cwd",
  notifications: "approval.applied.field.notifications",
  speakReplies: "approval.applied.field.speakReplies",
};

/** What a settled approval card says happened, or undefined while it is
 * still open. The card's own status line and the sidebar row both read this,
 * so a chat that ends on the card never says one thing in each place. */
/** What happens to a card waiting for an organization admin, naming the
 * admins when the server knows them. */
/** A "Me joindre" channel's name on a settled card. */
function reachChannelName(channel: string | undefined): string {
  if (channel === "sms") return t("botPanel.reachMe.sms.label");
  if (channel === "teams") return "Teams";
  if (channel === "telegram") return "Telegram";
  return t("botPanel.reachMe.label");
}

export function adminWillAnswerLine(adminNames: readonly string[] | undefined): string {
  const names = (adminNames ?? []).map((name) => name.trim()).filter(Boolean);
  return names.length
    ? t("approval.adminWillAnswer", { admins: names.join(", ") })
    : t("approval.adminWillAnswerUnnamed");
}

export function approvalCardOutcome(card: OptionCardData): string | undefined {
  if (card.expired === true) return t("approval.status.expired");
  if (!card.answered) return undefined;
  if (card.undone === true) return t("approval.status.undone");
  const isProposal = Boolean(card.routineRequest || card.skillRequest || card.profileRequest || card.modelRequest || card.ruleRequest || card.teamSetupRequest);
  if (card.answered !== "allow") return card.teamSetupRequest?.suggestion ? t("approval.status.notNow") : isProposal ? t("approval.status.cancelled") : t("approval.status.denied");
  if (card.teamSetupRequest) return card.teamSetupRequest.deletion ? "Bot deleted" : "Team setup applied";
  const routineAction = card.routineRequest?.operation.action;
  if (routineAction === "rotate_webhook_key") return t("approval.status.routineUpdated");
  if (routineAction) return t(ROUTINE_SETTLED_LABEL[routineAction]);
  const skillAction = card.skillRequest?.action;
  if (skillAction) return t(SKILL_SETTLED_LABEL[skillAction]);
  if (card.profileRequest) return t("approval.status.profileUpdated");
  if (card.modelRequest) return t("approval.status.modelChanged");
  if (card.ruleRequest) {
    return card.ruleRequest.operation.action === "remove"
      ? t("approval.status.ruleRemoved")
      : t("approval.status.ruleUpdated");
  }
  if (card.routineRequest) return t("approval.status.routineConfirmed");
  if (card.skillRequest) return t("approval.status.skillConfirmed");
  return t("approval.status.allowed");
}

/** A permission ask stays in the chat while it waits, and once a person
 *  answered it (or it expired) as a compact receipt with its status pill:
 *  Allowed once, Declined, Expired. An ask the engine closed on its own (the
 *  turn ended, nothing could answer it) leaves the transcript. A question or
 *  a quiz is not this card. A change that applied without a person is not an
 *  ask: it stays as its one line with Undo. */
export function approvalCardStaysInChat(
  card: Pick<OptionCardData, "requestId" | "tool" | "answered" | "expired" | "dismissed" | "autoApplied" | "held"> | undefined,
): boolean {
  if (!card?.requestId || !card.tool) return false;
  if (card.autoApplied === true && card.answered === "allow" && !card.held && card.dismissed !== true) return true;
  if (card.expired === true) return true;
  return card.dismissed !== true && card.answered !== "unavailable";
}

/** The status pill of a settled tool approval, as the reference design shows it. */
export function approvalPill(card: Pick<OptionCardData, "answered" | "expired" | "undone" | "alwaysAllowed" | "ruleSaved">): { label: string; tone: "success" | "danger" | "neutral" } | undefined {
  if (card.expired === true) return { label: t("approval.pill.expired"), tone: "neutral" };
  if (!card.answered) return undefined;
  if (card.undone === true) return { label: t("approval.status.undone"), tone: "neutral" };
  if (card.answered === "allow" && card.ruleSaved?.behavior === "allow") return { label: t("approval.pill.alwaysAllowed"), tone: "success" };
  if (card.answered === "deny" && card.ruleSaved?.behavior === "deny") return { label: t("approval.pill.alwaysDenied"), tone: "danger" };
  if (card.answered === "allow" && card.alwaysAllowed) return { label: t("approval.pill.alwaysAllowed"), tone: "success" };
  if (card.answered === "allow") return { label: t("approval.pill.allowedOnce"), tone: "success" };
  return { label: t("approval.pill.declined"), tone: "danger" };
}

/** 2026-10-28: a settled ask nobody had to answer by hand at that moment
 * (an Always allow saved or already kept, the model reviewer under the
 * person's rule) reads as the call's ordinary step line. "Always allowed"
 * and its check stay in the details, never on the line: a row of them under
 * each call read like a permission asked each time, Full access included. */
export function quietApprovalReceipt(card: Pick<OptionCardData, "answered" | "expired" | "undone" | "alwaysAllowed" | "ruleSaved" | "answeredBy">): boolean {
  if (card.answered !== "allow" || card.expired === true || card.undone === true) return false;
  return card.ruleSaved?.behavior === "allow" || Boolean(card.alwaysAllowed) || card.answeredBy?.via === "auto-review";
}

/** The product a card's tool serves, as the server declared it. */
function productOf(hints: unknown): { product?: string; productId?: string } {
  const value = hints && typeof hints === "object" ? hints as { product?: unknown; productId?: unknown } : {};
  return {
    ...(typeof value.product === "string" ? { product: value.product } : {}),
    ...(typeof value.productId === "string" ? { productId: value.productId } : {}),
  };
}

/** The line a card held by a rule waits on: the rule, named. */
export function heldByRuleLine(card: Pick<OptionCardData, "customRule" | "heldRule">): { label: string; target?: string } | undefined {
  if (card.customRule && (card.customRule.outcome === "held" || card.customRule.outcome === "risk")) {
    return { label: customRuleNoticeLine(card.customRule), target: card.customRule.when ? `« ${card.customRule.when} »` : undefined };
  }
  if (card.heldRule?.description) return { label: t("customRules.notice.held"), target: `« ${card.heldRule.description} »` };
  return undefined;
}

/** "Added to your Allow rules" with the rule in plain words and Edit rule,
 * under a card the person answered with Always allow. */
function AllowRuleInset({ rule }: { rule: string }) {
  const { dispatch } = useStore();
  return (
    <div data-allow-rule className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">
      <div className="font-medium text-ink">{t("approval.rule.added")}</div>
      <div className="mt-0.5">« {describeAllowRule(rule)} »</div>
      <button
        type="button"
        className="mt-1 text-accent hover:underline"
        onClick={() => dispatch({ type: "toggleSettings", open: true, section: "access" })}
      >
        {t("approval.rule.edit")}
      </button>
    </div>
  );
}

/** 2026-10-14: the owner's rule saved with this answer, in its words, with
 * a way to the rules page. */
function OwnerRuleInset({ rule }: { rule: NonNullable<OptionCardData["ruleSaved"]> }) {
  const { dispatch } = useStore();
  return (
    <div data-owner-rule-saved={rule.behavior} className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary">
      <div className="font-medium text-ink">{rule.behavior === "deny" ? t("approval.rule.savedDeny") : t("approval.rule.savedAllow")}</div>
      <div className="mt-0.5">« {rule.description} »</div>
      <button
        type="button"
        className="mt-1 text-accent hover:underline"
        onClick={() => dispatch({ type: "toggleSettings", open: true, section: "permissions" })}
      >
        {t("approval.rule.edit")}
      </button>
    </div>
  );
}

/** The tool's own name is noise to a human: Bash is "run a command",
 * mcp__perspicax_example_flow__acme_desk__query_schedule is "view the
 * schedule in Acme Desk" (the product the server declared). `input` (the
 * card's JSON arguments) lets a generic tool (acme_desk__write) say what it
 * writes. */
export function toolLabel(tool?: string, input?: string, hints?: ToolHints): string {
  if (!tool) return t("approval.tool.takeAction");
  const nice: ToolLabels = {
    Bash: "approval.tool.runCommand",
    Read: "approval.tool.readFile",
    Write: "approval.tool.writeFile",
    Edit: "approval.tool.editFile",
    WebFetch: "approval.tool.fetchWebPage",
    WebSearch: "approval.tool.searchWeb",
    schedule_routine: "approval.tool.scheduleRoutine",
    manage_routine: "approval.tool.changeRoutine",
    stage_skill: "approval.tool.enableSkill",
    update_skill: "approval.tool.updateSkill",
    update_profile: "approval.tool.updateProfile",
    propose_rule: "approval.tool.propose_rule",
    // An ACP driver can know the protocol's toolCall kind but not the
    // tool's name, and sends the kind as the card's tool
    // (server/drivers/acp/core.ts). Kinds are not verb phrases —
    // "wants to other" reads as broken — so map every kind it can send
    // to a real phrase. "shell" is its name for execute; "tool" is its
    // fallback when an agent sends no kind at all — an unclassified call,
    // so it reads differently from "other", the agent's own generic kind.
    shell: "approval.tool.runCommand",
    edit: "approval.tool.editFile",
    read: "approval.tool.readFile",
    fetch: "approval.tool.fetchWebPage",
    delete: "approval.tool.deleteFile",
    think: "approval.tool.think",
    other: "approval.tool.takeAction",
    tool: "approval.tool.useTool",
  };
  const key = nice[tool];
  if (key) return t(key);
  const { server, name } = parseToolId(tool);
  if (!server) return name.replace(/_/g, " ");
  const described = describeApproval(tool, input, hints);
  const action = described.action ?? name.replace(/_+/g, " ");
  // Sagax's own built-in servers (sagax-environment, sagax-computer) are the
  // bot itself: never "... in Sagax Computer" (shared approvalAction).
  return described.product && !server.startsWith("sagax-") ? t("approval.phrase.inProduct", { action, product: described.product }) : action;
}

/** What the card shows for a plain tool approval (not a proposal): a
 * title, a short summary, a risk chip, and the raw bits for the collapsed
 * technical details. A command or URL stays visible: it is what runs. */
export interface ToolApprovalView {
  title: string;
  summary?: string;
  risk?: ApprovalRisk;
  /** a command, URL or question: readable as is, shown under the title */
  plain?: string;
  server?: string;
  /** arguments for the details (pretty JSON when they are JSON) */
  args?: string;
}

export function toolApprovalView(card: OptionCardData, botName?: string): ToolApprovalView {
  const input = card.toolInput ?? card.subtitle;
  // the engine's own `<server>__<tool>` when `tool` is only a kind ("other")
  const tool = card.mcpTool ?? card.tool;
  const described = describeApproval(tool, input, card.toolHints);
  // "Allow Quasar to view the schedule in Acme Desk?" and one plain
  // line: the same generator the server uses for the push
  // (shared/approval-describe.ts), in this app's language.
  const words = approvalPlain({ botName, tool, toolInput: input, detail: card.subtitle, hints: card.toolHints });
  const technical = isTechnicalText(card.subtitle);
  const shown = technical || !card.subtitle?.trim() ? undefined : card.subtitle;
  // A held outbound action reads as what it sends and where, the way the
  // phones show it, not as the slug the bot happened to call.
  const outbound = outboundSummary(card);
  return {
    // 2026-10-20 (after the reference design): one plain line, "Ottoline wants to
    // run a command on your cloud computer", never a question to parse
    title: outbound ? outbound.headline : botName?.trim()
      ? t("approval.card.namedWantsTo", { name: botName.trim(), action: words.action })
      : t("approval.card.wantsTo", { action: words.action }),
    summary: outbound?.summary || described.summary || (words.line !== shown ? words.line : undefined),
    risk: described.risk,
    plain: shown,
    server: described.server,
    args: described.argsJson ?? (technical ? card.subtitle : undefined),
  };
}

/** When a routine runs, in the plain words the receipt line uses. Never a
 * raw cron expression: a schedule without a plain name says nothing. */
function plainWhen(schedule: RoutineRequestSchedule): string {
  if (schedule.type === "once") {
    return new Date(schedule.at).toDateString() === new Date().toDateString()
      ? t("approval.applied.today", { time: niceTime(schedule.at) })
      : `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  }
  if (schedule.type === "cron") {
    return cronIsDescribed(schedule, cronLocale()) ? cronScheduleLabel(schedule, cronLocale()) : "";
  }
  if (schedule.type === "interval") return scheduleLabel({ ...schedule, anchorAt: schedule.anchorAt ?? 0 });
  // Request wire omits derived `at`; label from engine + repeat only.
  if (schedule.type === "limit_reset") return scheduleLabel({ ...schedule, at: null });
  return scheduleLabel(schedule);
}

/** The one line a change that applied without a person reads as, and
 * whether its Undo can work (the card kept what Undo needs). */
export function appliedChange(card: OptionCardData, name: string): { line: string; canUndo: boolean } | undefined {
  const routine = card.routineRequest;
  if (routine) {
    const operation = routine.operation;
    const undo = routine.undo;
    const when = undo?.schedule && operation.action !== "pause" && operation.action !== "delete" && operation.action !== "run_now"
      ? plainWhen(undo.schedule)
      : "";
    const title = [
      undo?.name ?? (operation.action === "create" ? operation.routine.name : ""),
      operation.forBot ? t("approval.applied.forBot", { target: `@${operation.forBot.name}` }) : "",
    ].filter(Boolean).join(" · ") + (when ? `, ${when}` : "");
    if (operation.action === "rotate_webhook_key") {
      return { line: t("approval.applied.routine.update", { name, title }), canUndo: false };
    }
    const canUndo = operation.action === "create" ? Boolean(routine.resultId)
      : operation.action === "update" ? Boolean(undo?.before && undo.appliedUpdatedAt !== undefined)
        : operation.action === "pause" || operation.action === "resume" ? undo?.appliedUpdatedAt !== undefined
          : operation.action === "delete" ? Boolean(undo?.before)
            : false;
    const lineKey = operation.action === "create" && operation.paused === true
      ? "approval.applied.routine.createPaused"
      : ROUTINE_APPLIED_LINE[operation.action];
    return { line: t(lineKey, { name, title }), canUndo };
  }
  const skill = card.skillRequest;
  if (skill) {
    return {
      line: t(SKILL_APPLIED_LINE[skill.action], { name, title: skill.name }),
      canUndo: skill.action === "create" || Boolean(skill.previous),
    };
  }
  const profile = card.profileRequest;
  if (profile) {
    const title = PROFILE_REQUEST_FIELDS.filter((field) => profile.changes[field] !== undefined)
      .map((field) => t(PROFILE_FIELD_LABEL[field])).join(", ");
    const line = profile.targetBotId === profile.botId
      ? t("approval.applied.profileOwn", { name, title })
      : t("approval.applied.profileOther", { name, target: `@${profile.targetName}`, title });
    return { line, canUndo: Boolean(profile.undo) };
  }
  const model = card.modelRequest;
  if (model) {
    const title = model.selection.model;
    const line = model.targetBotId === model.botId
      ? t("approval.applied.modelOwn", { name, title })
      : t("approval.applied.modelOther", { name, target: `@${model.targetName}`, title });
    return { line, canUndo: true };
  }
  const rule = card.ruleRequest;
  if (rule) {
    const title = rule.sentence;
    const key = rule.operation.action === "add"
      ? "approval.applied.ruleAdd"
      : rule.operation.action === "change"
        ? "approval.applied.ruleChange"
        : "approval.applied.ruleRemove";
    return { line: t(key, { name, title }), canUndo: false };
  }
  return undefined;
}

/** A change the bot made without a person, as one plain line with Undo
 * instead of the approval box. The full card text stays one click away. */
function AppliedChangeLine({
  card,
  name,
  threadId,
  summary,
}: {
  card: OptionCardData;
  name: string;
  threadId?: string;
  summary: { line: string; canUndo: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string>();
  const undone = card.undone === true;
  const undo = () => {
    if (!threadId || !card.requestId || undoing) return;
    setUndoing(true);
    setError(undefined);
    api(`/api/threads/${threadId}/undo`, { method: "POST", body: JSON.stringify({ requestId: card.requestId }) })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiError && failure.body?.code === "changed-since"
          ? t("approval.applied.changedSince")
          : t("approval.applied.undoFailed", { error: readableError(failure) }));
      })
      .finally(() => setUndoing(false));
  };
  return (
    <div className="w-full max-w-[840px] text-[13px] text-ink-secondary" data-applied-change={name}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {undone ? <Undo2 size={14} className="shrink-0" /> : <Check size={14} className="shrink-0 text-success" />}
        <span className="min-w-0 break-words">
          {summary.line}
          {undone && <span> · {t("approval.applied.undone")}</span>}
        </span>
        {!undone && summary.canUndo && threadId && (
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-inset disabled:opacity-60"
          >
            {undoing ? t("approval.applied.undoing") : t("approval.applied.undo")}
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="rounded-md px-1.5 py-0.5 text-ink-tertiary hover:bg-inset hover:text-ink-secondary"
        >
          {open ? t("approval.applied.hideDetails") : t("approval.applied.details")}
        </button>
      </div>
      {error && <div role="alert" className="mt-1 text-[12.5px] text-warning">{error}</div>}
      {open && (
        <pre
          tabIndex={0}
          aria-label={t("approval.aria.appliedDetails")}
          className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink"
        >
          {card.subtitle}
        </pre>
      )}
    </div>
  );
}

export function ApprovalCard({
  bot,
  message,
  threadId,
}: {
  /** who is asking, for the "Name wants to …" line */
  bot?: Pick<Bot, "name">;
  message: Message;
  /** the conversation the card is in, for Undo on a change that applied
   * without a person */
  threadId?: string;
}) {
  const card = message.card;
  if (!card) return null;
  // A change that applied without a person reads as one line with Undo.
  const applied = card.autoApplied === true && card.answered === "allow" && !card.held
    ? appliedChange(card, bot?.name ?? t("approval.someone"))
    : undefined;
  if (applied) return <AppliedChangeLine card={card} name={bot?.name ?? t("approval.someone")} threadId={threadId} summary={applied} />;
  const settled = card.answered;
  const expired = card.expired === true;
  // decided by voice on a Live call rather than tapped
  // or answered from an AI client attached to Perspicax (lot C.3)
  const byVoice = card.answeredBy?.via === "call" ? <span className="text-ink-tertiary">· {t("approval.status.byVoice")}</span>
    : card.answeredBy?.via === "ai-client" ? <span className="text-ink-tertiary">· {t("approval.status.byAiClient")}</span>
      // decided by the model reviewer under the person's rule (lot A1)
      : card.answeredBy?.via === "auto-review" ? <span className="text-ink-tertiary" data-answered-via="auto-review">· {t("approval.status.byAutoReview")}</span>
      // answered by a bot the person owns, from their own message (sagax_approvals)
      : card.answeredBy?.via === "primary-bot" ? <span className="text-ink-tertiary" data-answered-via="primary-bot">· {t("approval.status.viaBot", { name: card.answeredBy.bot ?? t("approval.someone") })}</span>
      // answered from the person's "Me joindre" channel (a text, Telegram, Teams)
      : card.answeredBy?.via === "reach-me" ? <span className="text-ink-tertiary" data-answered-via="reach-me">· {t("approval.status.viaChannel", { name: reachChannelName(card.answeredBy.channel) })}</span> : null;
  const isRoutineRequest = Boolean(card.routineRequest);
  const isSkillRequest = Boolean(card.skillRequest);
  const isProfileRequest = Boolean(card.profileRequest);
  const isRuleRequest = Boolean(card.ruleRequest);
  const isTeamSetup = Boolean(card.teamSetupRequest);
  const routineAction = card.routineRequest?.operation.action;
  const skillAction = card.skillRequest?.action;
  const heldNote = card.heldCode === "approval.held.native" || card.heldCode === "approval.held.gate" ? undefined : tFromServer(card.heldCode, card.held);
  const outcome = approvalCardOutcome(card);
  const displayTool = isRoutineRequest
    ? routineAction === "create" ? "schedule_routine" : "manage_routine"
    : isSkillRequest
      ? skillAction === "update" ? "update_skill" : "stage_skill"
    : isProfileRequest
      ? "update_profile"
    : isRuleRequest
      ? "propose_rule"
    : card.tool;
  // A cross-bot profile card is shown in the PROPOSER's thread, so
  // "wants to update its profile" (fine for a bot editing itself) would
  // silently claim the proposer's own profile is changing. Name the actual
  // target whenever it differs from the proposer.
  const profileHeader = isProfileRequest && card.profileRequest
    ? card.profileRequest.targetBotId === card.profileRequest.botId
      ? t("approval.card.profileWantsToOwn", { name: bot?.name ?? t("approval.someone") })
      : t("approval.card.profileWantsToOther", {
          name: bot?.name ?? t("approval.someone"),
          target: card.profileRequest.targetName,
        })
    : undefined;

  const isProposal = isRoutineRequest || isSkillRequest || isProfileRequest || isRuleRequest || isTeamSetup;
  const view = isProposal ? undefined : toolApprovalView(card, bot?.name);
  const proposalTitle = isTeamSetup
    ? card.title
    : isRuleRequest && card.title
      ? card.title
    : profileHeader ?? (bot
      ? t("approval.card.namedWantsTo", { name: bot.name, action: toolLabel(displayTool) })
      : t("approval.card.wantsTo", { action: toolLabel(displayTool) }));
  const open = !settled && !expired;

  // One card per request (2026-10-15): the box above the composer shows
  // a tool request in full with its buttons; the thread only says it waits,
  // as a quiet step line. A proposal (routine, skill, profile, team setup)
  // keeps its card: what it changes, and for whom, is reviewed there.
  if (open && view) {
    // an "Ask first" rule (the organization's or the person's) held it: the
    // line says which rule, whatever the approval level
    const byRule = !card.reviewing && !card.adminApproval ? heldByRuleLine(card) : undefined;
    return (
      <StepRow
        testId="approval-waiting"
        data={{ "data-tour": "approval", "data-approval-waiting": card.requestId, ...(card.reviewing ? { "data-auto-review": "pending" } : {}), ...(byRule ? { "data-held-by-rule": "" } : {}) }}
        icon={<ShieldCheck size={13} aria-hidden="true" className="text-accent" />}
        label={card.reviewing ? t("customRules.notice.reviewing") : card.adminApproval ? t("approval.waitingForAdmin") : byRule ? byRule.label : t("approval.status.waitingApproval")}
        target={card.adminApproval ? adminWillAnswerLine(card.adminNames) : byRule?.target}
      />
    );
  }

  // Answered or expired, a tool approval is a one-line receipt (#455) that
  // opens on what was asked, the saved rule and the technical details.
  if (view && quietApprovalReceipt(card)) {
    const pill = approvalPill(card);
    const step = readStep({ name: card.mcpTool ?? card.tool ?? "tool", ok: true, ...(card.toolInput ? { input: card.toolInput } : {}), ...productOf(card.toolHints) });
    return (
      <StepRow testId="approval-receipt-quiet" data={{ "data-approval-receipt": "quiet" }} label={step.label} target={step.target}>
        {() => (
          <div className="flex flex-col gap-1 text-[12.5px] text-ink-secondary" data-testid="approval-receipt-detail">
            <div className="flex items-center gap-1.5 text-ink">
              <Check size={13} aria-hidden="true" className="text-success" />
              <span>{card.answeredBy?.via === "auto-review" ? t("customRules.notice.modelApproved") : pill?.label}</span>
              {byVoice}
            </div>
            {view.summary && <div>{view.summary}</div>}
            {card.alwaysAllowed && <AllowRuleInset rule={card.alwaysAllowed} />}
            {card.ruleSaved && <OwnerRuleInset rule={card.ruleSaved} />}
            {card.customRule && <CustomRuleNoticeLine notice={card.customRule} />}
            {card.customRuleSaved && <CustomRuleSavedInset rule={card.customRuleSaved} botId={message.from?.botId} />}
            {(view.args || card.tool) && <TechnicalDetails tool={card.tool} server={view.server} args={view.args} />}
          </div>
        )}
      </StepRow>
    );
  }

  if (view) {
    const pill = approvalPill(card);
    // what was asked, as an action: "Send to Linear", "View accounts in Twilio"
    const outbound = outboundSummary(card);
    const action = outbound ? outbound.headline.replace(/\s*[?？]$/, "") : toolLabel(card.mcpTool ?? card.tool, card.toolInput ?? card.subtitle, card.toolHints);
    return (
      <StepRow
        testId="approval-receipt"
        data={{ "data-approval-receipt": pill?.tone }}
        icon={<span data-status-pill={pill?.tone} className="flex">
          {pill?.tone === "success" ? <Check size={13} aria-hidden="true" className="text-success" />
            : <X size={13} aria-hidden="true" className={pill?.tone === "danger" ? "text-danger" : "text-ink-tertiary"} />}
        </span>}
        label={pill?.label ?? outcome ?? ""}
        target={action ? action[0]!.toLocaleUpperCase() + action.slice(1) : undefined}
        extra={byVoice}
      >
        {() => (
          <div className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
            <div className="text-ink">{view.title}</div>
            {view.summary && <div>{view.summary}</div>}
            {view.plain && (
              <pre tabIndex={0} aria-label={t("approval.aria.details")} className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink">
                {view.plain}
              </pre>
            )}
            {heldNote && <div className="text-ink-secondary">{heldNote}</div>}
            {card.answered === "allow" && card.alwaysAllowed && <AllowRuleInset rule={card.alwaysAllowed} />}
            {card.answered && card.ruleSaved && <OwnerRuleInset rule={card.ruleSaved} />}
            {card.customRule && <CustomRuleNoticeLine notice={card.customRule} />}
            {card.answered === "allow" && card.customRuleSaved && <CustomRuleSavedInset rule={card.customRuleSaved} botId={message.from?.botId} />}
            {(view.args || card.tool) && <TechnicalDetails tool={card.tool} server={view.server} args={view.args} />}
          </div>
        )}
      </StepRow>
    );
  }

  return (
    <div
      data-tour={open ? "approval" : undefined}
      className={cn(
        "w-full max-w-[840px] rounded-2xl border bg-card px-4 py-3",
        open ? "border-accent/40" : "border-hairline/30 opacity-80",
      )}
    >
      <ApprovalHeading
        bot={bot}
        title={proposalTitle}
      />

      {/* a proposal's text is what you confirm (a tool request reads as the
          step line or the receipt above) */}
      <pre
        tabIndex={0}
        aria-label={
          isRoutineRequest
            ? t("approval.aria.routineDetails")
            : isSkillRequest
              ? t("approval.aria.skillDetails")
              : isProfileRequest
                ? t("approval.aria.profileChange")
                : isRuleRequest
                  ? t("approval.aria.ruleChange")
                : t("approval.aria.details")
        }
        className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink"
      >
        {card.subtitle}
      </pre>

      {card.skillRequest && <SkillRequestPreview request={card.skillRequest} />}

      {heldNote && (
        <div className="mt-2 text-[12.5px] text-ink-secondary">
          {heldNote}
        </div>
      )}

      {card.answered === "allow" && card.alwaysAllowed && <AllowRuleInset rule={card.alwaysAllowed} />}
      {card.answered && card.ruleSaved && <OwnerRuleInset rule={card.ruleSaved} />}

      {/* The decision lives in the composer (one place to answer, and it
          can't be scrolled past); here we only record what happened. The
          technical details join the record once it is settled, so an open
          request is never shown twice in full. */}
      <div className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-secondary">
        {outcome ? (
          <>
            {settled === "allow" && !expired ? <Check size={14} className="text-success" /> : <X size={14} />} {outcome}
            {byVoice}
          </>
        ) : card.reviewing ? (
          <>
            <ShieldCheck size={14} className="text-accent" />
            <span data-auto-review="pending">{t("customRules.notice.reviewing")}</span>
          </>
        ) : (
          <>
            <ShieldCheck size={14} className="text-accent" />
            {t("approval.status.waitingConfirmation")}
          </>
        )}
      </div>
    </div>
  );
}
