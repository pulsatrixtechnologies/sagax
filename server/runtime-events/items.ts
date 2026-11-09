// @ts-nocheck
/** handleItemEvents (#1388). Pure move from server/index.ts bus.subscribe. */
import { DATA_DIR } from "../config.ts";
import { saveImage } from "../attachments/attachments.ts";
import { screenSurfaceForTool, screenTouchingTool } from "../computer/screen-frame-gate.ts";
import { dropCancelledVoiceEvent } from "../voice/voice-call-duplex.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../shared/phone-tools.ts";
import { cwToolRowWidget } from "../widgets/cw-widget-actions.ts";
export function handleItemEvents(event: any, ctx: any, host: any): void {
  const {
    bot, pushMessage, pushAssistantText, routineRun, staleAssistant, liveTurnId,
  } = ctx;
  switch (event.type) {
    case "item.completed":
      if (dropCancelledVoiceEvent(staleAssistant, event)) break;
      if (event.itemType === "assistant_text") {
        // kept so "finished" can say what it finished with, rather than
        // just that something ended. A client abort stores no reply text.
        pushAssistantText(event.text, event.turnId);
      } else if (event.itemType === "assistant_image") {
        try {
          const decoded = host.decodeGeneratedImage(event.data);
          const saved = saveImage(decoded.bytes, decoded.mime);
          const key = host.turnAttachmentKey(event.threadId, event.turnId);
          const current = host.turnAttachmentsByTurn.get(key) ?? [];
          current.push({ kind: "image", path: saved.path, mime: saved.mime });
          host.turnAttachmentsByTurn.set(key, current);
        } catch (error) {
          pushMessage({
            role: "bot",
            kind: "activity",
            tool: {
              name: `generated image could not be attached — ${error instanceof Error ? error.message : "invalid image"}`.slice(0, 160),
              ok: false
            }
          });
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const itemKey = `${event.threadId}:${event.itemId}`;
        const messageId = host.toolMessageByItem.get(itemKey);
        let toolName = "tool";
        let stepDurationMs: number | undefined;
        if (messageId) {
          // the whole tool object is replaced, so carry `spoken` across —
          // dropping it here would silently un-narrate every completed tool
          const row = host.store.messagesFor(event.threadId).find((m) => m.id === messageId);
          // #3126: arguments the engine sent after the start (grok's use_tool) replace the "{}" it showed
          const existing = row?.tool && typeof event.input === "string" && event.input ? { ...row.tool, input: event.input } : row?.tool;
          toolName = existing?.name ?? "tool";
          const widget = event.ok && event.resultText ? cwToolRowWidget(toolName, existing?.input, event.resultText, host.latestPersonText(event.threadId)) : null;
          // How long the call ran, for the step row's quiet duration.
          const durationMs = row ? Math.max(0, Date.now() - row.at) : undefined;
          stepDurationMs = durationMs;
          // what a phone answered goes to the turn, never into the transcript
          const output = isPhoneToolCallName(toolName) ? PHONE_TOOL_OUTPUT_NOT_KEPT : event.output;
          host.store.patchMessage(event.threadId, messageId, {
            tool: { ...existing, name: toolName, ok: event.ok, output, ...(durationMs !== undefined ? { durationMs } : {}), ...(widget ? { widget } : {}) }
          });
          host.toolMessageByItem.delete(itemKey);
          // a "Connect Microsoft Teams" card's proof: whose turn made this call, on which bot
          host.connectorSetupProofs.record({ threadId: event.threadId, botId: bot?.id, principalId: host.connectorSetupSpeaker(event.threadId), name: toolName, input: existing?.input, ok: event.ok === true, at: Date.now() });
          // a part run on another engine (run_with_engine) proves the card of the conversation it came from
          // #2749: a connector whose sign-in expired posts its Connect card, said plainly
          if (event.ok !== true) host.noteConnectorReauth?.(event.threadId, toolName, typeof event.output === "string" ? event.output : event.resultText);
          const relayParent = host.relayParentThreads.get(event.threadId);
          if (relayParent) host.connectorSetupProofs.record({ threadId: relayParent, botId: bot?.id, principalId: host.connectorSetupSpeaker(relayParent), name: toolName, input: existing?.input, ok: event.ok === true, at: Date.now() });
          const appPiece = event.resultText ? host.noteAppRead(toolName, event.resultText) : null;
          if (appPiece) {
            const kept = host.appPiecesByThread.get(event.threadId) ?? [];
            kept.push(appPiece);
            host.appPiecesByThread.set(event.threadId, kept.slice(-8));
          }
        }
        // the end of a call is the safe point a waiting message needs
        if (bot) host.safePoints.toolEnded(event.threadId, host.toolsRunning(event.threadId));
        for (const videoMsg of event.output ? host.videoMessagesFromTool(toolName, event.output, event.threadId, host.latestPersonText(event.threadId)) : []) {
          pushMessage(videoMsg);
        }
        // V9: content-free step journal (no args, no body). Fire-and-forget.
        if (bot) {
          const run = routineRun ?? (host.routines ? host.activeRoutineRunForThread(event.threadId) : null);
          const routineName = run ? host.routines?.listRoutines().find((entry) => entry.id === run.routineId)?.name : undefined;
          host.appendStep(DATA_DIR, host.stepFromToolEvent({
            botId: bot.id,
            threadId: event.threadId,
            tool: toolName,
            ok: event.ok === true,
            output: typeof event.output === "string" ? event.output.slice(0, 400) : undefined,
            ...(run?.id ? { runId: run.id } : {}),
            ...(routineName ? { routineName } : {}),
            ...(stepDurationMs !== undefined ? { ms: stepDurationMs } : {})
          }));
        }
        // the bot just acted ON ITS SCREEN — refresh the preview now. Only
        // computer tools can change the screen, and each capture competes
        // with the agent for the boat's command endpoint, so a bot grinding
        // through file edits must not trigger one per tool. The refresh is
        // deliberately broad (a computer_exec may well have launched a
        // window); whether the turn has EARNED a settled screenshot is the
        // narrower question, and only the allow-list answers it.
        if (bot) {
          const touches = screenTouchingTool(toolName);
          const surface = screenSurfaceForTool(toolName);
          if (touches || /computer|screenshot|click|type_text|press_key|scroll|open_url|wait_for|browser_/i.test(toolName)) {
            host.pokeScreenPoller(event.threadId, touches, surface);
          }
        }
      }
      break;
    case "item.started":
      if (dropCancelledVoiceEvent(staleAssistant, event)) break;
      if (event.itemType === "tool") {
        // ask_bot's raw tool chip is redundant — the internal endpoint
        // appends a richer "Messaged @X" chip linking to the channel
        if (event.title?.endsWith("__ask_bot")) break;
        const name = event.title ?? "tool";
        // 2026-11-01: on a proactive wake, record a dry run before a write
        // goes through ordinary approval (visible on the wake's report).
        if (bot && host.proactiveWakeForThread(event.threadId)) {
          let command: string | undefined;
          if (typeof event.input === "string") {
            try {
              const parsed = JSON.parse(event.input) as { command?: unknown };
              if (typeof parsed.command === "string") command = parsed.command;
            } catch { /* input is plain text */ }
          }
          host.noteWakeDryRun(event.threadId, bot.id, name, command);
        }
        // narration is folded in here, once, so call mode can read the
        // chip aloud without re-deriving it — and so the phrase a user
        // hears and the chip they see can never drift apart
        const approved = host.autoApprovals.takePending(event.threadId, name);
        const actedAs = host.roleEvents.takePending(event.threadId, name);
        const product = host.declaredToolProduct(bot?.id, name, event.input);
        // 2026-10-29: the step the working line names, the same for every
        // engine (shared/working-step.ts); older clients ignore the field
        const step = host.toolWorkingStep({ name, summary: event.summary, input: event.input, product: product?.product });
        // 2026-11-05 (#2033): no tool.role on chat steps; the role journal keeps it
        const message = pushMessage({
          role: "bot",
          kind: "activity",
          tool: { name, spoken: host.narrateTool(name) ?? undefined, summary: event.summary, input: event.input, itemId: event.itemId ?? event.eventId, ...(event.files?.length ? { files: event.files } : {}),
            ...(approved ? { autoApproval: approved.approval, ...(approved.notice ? { ruleNotice: approved.notice } : {}) } : {}),
            ...(actedAs ? { role: actedAs } : {}),
            ...product,
            ...(step ? { step } : {}),
            ...(event.parentItemId ? { parentItemId: event.parentItemId } : {}) },
          // attributed to its turn so the digest can count it
          turnId: liveTurnId
        });
        if (event.itemId) host.toolMessageByItem.set(`${event.threadId}:${event.itemId}`, message.id);
      }
      break;
  }
}
