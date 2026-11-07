import { AlertTriangle, Info, MessageSquareWarning, RefreshCw } from "lucide-react";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { CHATGPT_USAGE_URL, ManageUsageLink } from "../ChatGptPlanStatus";
import { CODEX_USAGE_URL, codexUsageLimitReached } from "../../../shared/codex-usage-limit";
import { ClaudeUpdatePrompt } from "../ClaudeUpdatePrompt";
import { MacCuaRecoveryActions } from "../MacCuaRecoveryActions";
import { macCuaPermissionMessage, missingMacCuaPermissions } from "@/lib/mac-cua-permissions";
import { failedTurnCause, isEngineLimitFailure, signedOutEngine } from "@/lib/failed-turn";
import { localizedEngineCause } from "@/lib/engine-error-text";
import { plainErrorLine } from "@/lib/plain-error";
import { openPlaceAction, placeRowViewFor, usePlaceSeat, worksOnSimpleLabel } from "@/lib/place-view";
import type { PlaceRow } from "../../../shared/place-view";
import { isProviderReplyCut } from "../../../shared/provider-reply-cut";
import { isProviderSafetyBlock, PROVIDER_SAFETY_GUIDANCE, PROVIDER_SAFETY_HELP_URL } from "../../../shared/provider-safety";
import { EngineSetup } from "../EngineSetup";
import { useLimitResetContinue } from "../LimitResetContinue";
import { viewerCan } from "@/lib/viewer";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import type { InstanceInfo, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOpenFeedback } from "@/lib/use-open-feedback";
import { MessageBoundary, StepBoundary } from "../MessageBoundary";

export function ErrorRow({
  message,
  headline: plainHeadline,
  onRetry,
  action,
  setupInstance,
  claudeUpdateInstance,
  onReport,
}: {
  message: string;
  /** A plain sentence to open with instead of `message` (FailedTurnRow's
   * signed-out line, or the plain line for a technical cause from
   * src/lib/plain-error.ts); `message` then moves under Details. */
  headline?: string;
  onRetry?: () => void;
  /** The one next action a failed place names (shared/place-view.ts), in
   * place of Retry; null for a place with nothing to do here. */
  action?: { label: string; onClick: () => void } | null;
  setupInstance?: InstanceInfo;
  /** The Claude engine to update when this turn failed because its Claude
   * Code is too old for the model. */
  claudeUpdateInstance?: InstanceInfo;
  /** "Report this problem" (#2618): opens a report with the Feedback bot,
   * this card's words attached. Only where the caller passes it. */
  onReport?: () => void;
}) {
  "use memo";
  const { capabilities, ready } = useDesktopCapabilities();
  const failedPermissions = missingMacCuaPermissions(message);
  const currentPermissions = missingMacCuaPermissions(capabilities.localComputer.message);
  const macCuaReason = ready && capabilities.host.platform === "darwin" &&
    capabilities.localComputer.available === false && capabilities.localComputer.reasonCode !== "remote-server" &&
    message.startsWith("CUA Driver is not ready for this computer — ") &&
    failedPermissions.length > 0 && failedPermissions.join(",") === currentPermissions.join(",")
    ? macCuaPermissionMessage(currentPermissions)
    : null;
  const headline = macCuaReason ?? plainHeadline ?? message;
  const usageUrl = action ? null : message.includes("subscription_sharing_usage_limit_exceeded") ? CHATGPT_USAGE_URL : codexUsageLimitReached(message) ? CODEX_USAGE_URL : null;
  return (
    <div className="flex justify-start">
      <div className="w-fit max-w-[min(42rem,78%)] rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-5 text-danger">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{headline}</span>
        </div>
        {headline !== message && <details className="mt-2 text-[12px] text-ink-secondary"><summary className="cursor-pointer">{macCuaReason ? t("computer.mac.permission.driverDetail") : t("chat.error.details")}</summary><p className="mt-1 break-words">{message}</p></details>}
        {macCuaReason &&
          <MacCuaRecoveryActions reason={message} />}
        {usageUrl ? (
          <ManageUsageLink href={usageUrl} className="ui-button ui-button-md mt-2 border-transparent bg-ink text-app hover:brightness-110" />
        ) : claudeUpdateInstance ? (
          <ClaudeUpdatePrompt instance={claudeUpdateInstance} onRetry={onRetry} />
        ) : isProviderSafetyBlock(message) ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
            {PROVIDER_SAFETY_GUIDANCE}{" "}
            <a href={PROVIDER_SAFETY_HELP_URL} target="_blank" rel="noreferrer" className="underline">{t("chat.providerSafetyHelp")}</a>
          </p>
        ) : isProviderReplyCut(message) ? null
        : setupInstance &&
        !(setupInstance.snapshot.state === "available" && setupInstance.snapshot.authenticated !== false) ? (
          <EngineSetup instance={setupInstance} className="mt-2 text-ink-secondary" />
        ) : action !== undefined ? (
          action && (
            <button
              type="button"
              onClick={action.onClick}
              className="ui-button ui-button-md mt-1.5 rounded-full border-danger/30 bg-transparent text-danger hover:bg-danger/15"
            >
              {action.label}
            </button>
          )
        ) : (
          onRetry && (
            <button
              onClick={onRetry}
              className="ui-button ui-button-md mt-1.5 rounded-full border-danger/30 bg-transparent text-danger hover:bg-danger/15"
            >
              <RefreshCw size={12} /> {t("chat.retry")}
            </button>
          )
        )}
        {onReport && (
          <button
            type="button"
            data-report-problem=""
            onClick={onReport}
            className="ui-button ui-button-md ml-1.5 mt-1.5 rounded-full border-transparent bg-transparent text-ink-secondary hover:bg-danger/10 hover:text-danger"
          >
            <MessageSquareWarning size={12} aria-hidden="true" /> {t("feedback.errorCard.report")}
          </button>
        )}
      </div>
    </div>
  );
}

/** A place that could not be used: its one line and its one next action
 * (shared/place-view.ts), never the provider's raw words or a second
 * button. Try again is the conversation's own retry, offered only where a
 * retry exists. */
function PlaceFailedRow({ place, botId, threadId, onRetry }: {
  place: PlaceRow;
  botId: string;
  threadId?: string;
  onRetry?: () => void;
}) {
  "use memo";
  const dispatch = useStoreDispatch();
  const config = useStoreSelector((current) => current.config);
  const computer = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === botId)?.computer);
  const { capabilities } = useDesktopCapabilities();
  const seat = usePlaceSeat(config, capabilities.host.platform);
  const view = placeRowViewFor(place, seat, worksOnSimpleLabel(computer, capabilities.host.platform));
  const id = view.action?.id;
  const onClick = !id ? undefined
    : id === "try-again" ? onRetry
    : () => { openPlaceAction(id, { botId, threadId }, dispatch); };
  return <ErrorRow message={view.line} action={view.action && onClick ? { label: view.action.label, onClick } : null} />;
}

/** Only a local, editable Claude Code engine can be updated from chat: not a
 * company-managed one, not one this server's image pins, and not when the
 * viewer cannot manage engines (a member without engines.manage). */
export function claudeUpdateTarget(
  engine: InstanceInfo | undefined,
  options: { canManageEngines?: boolean } = {},
): InstanceInfo | undefined {
  if (!engine || engine.driverKind !== "claudeAgent" || engine.readOnly || engine.pinned) return undefined;
  if (options.canManageEngines === false) return undefined;
  return engine;
}

/** A failed turn's stored row ("error: …", src/lib/failed-turn.ts), shown
 * the same in a 1:1 chat and a room: the server writes the same row for both,
 * so both read it here. `engine` is the one the turn ran on — what its
 * sign-in or update card acts on. A place that could not be used is worded
 * again from its stored state, in this reader's language and role. */
export function FailedTurnRow({ tool, engine, onRetry, botId, threadId }: {
  tool: NonNullable<Message["tool"]>;
  engine: InstanceInfo | undefined;
  onRetry?: () => void;
  /** The bot the turn ran as, and its conversation: where a place's next action goes. */
  botId?: string;
  threadId?: string;
}) {
  "use memo";
  const config = useStoreSelector((current) => current.config);
  // Hook before any early return (rules of hooks); unused when the limit row is hidden.
  const resume = useLimitResetContinue(botId, threadId, tool.limitResetsAt);
  const openFeedback = useOpenFeedback();
  // An engine at its limit or out of credit: the composer says so, not the chat.
  if (isEngineLimitFailure(tool)) return null;
  if (tool.place && botId) return <PlaceFailedRow place={tool.place} botId={botId} threadId={threadId} onRetry={onRetry} />;
  const signedOut = signedOutEngine(tool, engine);
  // A signed-out engine: its sign-in card is the whole answer, no error row or
  // Details above it. Without a card to show, the row below stays.
  if (signedOut && tool.setup && engine && !(engine.snapshot.state === "available" && engine.snapshot.authenticated !== false)) {
    return <div className="flex justify-start"><EngineSetup instance={engine} className="text-ink-secondary" /></div>;
  }
  const rawCause = failedTurnCause(tool.name) ?? tool.name;
  const cause = localizedEngineCause(rawCause) ?? rawCause;
  // A content-filter or length cut: keep the partial reply, mark it with a
  // quiet notice (no Retry, no red failure). shared/provider-reply-cut.ts.
  if (isProviderReplyCut(rawCause)) {
    const line = plainErrorLine(rawCause) ?? cause;
    return (
      <div role="status" className="flex w-fit max-w-[min(42rem,78%)] items-start gap-2 rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{line}</span>
      </div>
    );
  }
  const updateTarget = tool.claudeUpdate
    ? claudeUpdateTarget(engine, { canManageEngines: viewerCan(config, "engines.manage") })
    : undefined;
  // Claude Code too old for the model, but this viewer cannot update it (a
  // member, a pinned image, or a company-managed engine): say so, never offer
  // "Update Claude for me" or a Terminal command that would not reach the server.
  const pinnedUnavailable = Boolean(tool.claudeUpdate && !updateTarget);
  return (
    <ErrorRow
      message={cause}
      headline={pinnedUnavailable
        ? t("chat.claudeUpdate.unavailable")
        : signedOut ? t("chat.error.signedOut", { name: signedOut.displayName }) : plainErrorLine(cause)}
      onRetry={pinnedUnavailable ? undefined : onRetry}
      action={resume}
      setupInstance={tool.setup && !pinnedUnavailable ? engine : undefined}
      claudeUpdateInstance={updateTarget}
      onReport={() => void openFeedback({ source: "error", error: cause })}
    />
  );
}

/** The text fallback for a row that will not draw. Rooms import it from here. */

/** #2013: a room has no composer line for a bot's engine, so an engine
 * that refused a turn before any prompt went out is said there quietly, in
 * the reader's words, never as a red card. */
export function PreSendRefusalLine({ tool }: { tool: NonNullable<Message["tool"]> }) {
  const rawCause = failedTurnCause(tool.name) ?? tool.name;
  const cause = localizedEngineCause(rawCause) ?? rawCause;
  const line = plainErrorLine(rawCause) ?? cause;
  return (
    <div role="status" data-presend-refusal className="flex w-fit max-w-[min(42rem,78%)] items-start gap-2 rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[12.5px] leading-5 text-ink-secondary">
      <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{line}</span>
    </div>
  );
}

export { MessageBoundary, StepBoundary };
