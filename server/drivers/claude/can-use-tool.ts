// #4525: Claude's --permission-prompt-tool stdio sends can_use_tool on
// stdout, including a consent disclosure the MCP approve wire cannot
// carry. The answer is the same broker card as every other permission.
import { newId } from "../../contracts.ts";
import { ARTIFACT_DATA_CONSENT_FALLBACK, isArtifactDataWriteConsent } from "../../../shared/artifact-data-consent.ts";
import { reportBackgroundError } from "../../background-error.ts";
import {
  ASK_USER_QUESTION,
  ASK_USER_QUESTION_UNANSWERABLE,
  allowPermissionResult,
  asPermissionInput,
  classifyPermissionPrompt,
  nativeQuestionDecision,
  type PermissionFacts,
} from "./permission-prompt.ts";
import type { ClaudeSession } from "./session-types.ts";

const DISCLOSURE_MAX = 4_000;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type ClaudeCanUseTool = {
  /** Consumes a can_use_tool control_request. False for every other frame. */
  frame(message: unknown): boolean;
};

export function claudeCanUseTool(
  read: () => ClaudeSession,
  writeFrame: (frame: unknown) => Promise<boolean>,
): ClaudeCanUseTool {
  const factsOf = (session: ClaudeSession): PermissionFacts => ({
    searched: session.searchedMounts,
    preallowed: session.permissionFacts?.preallowed ?? [],
    artifactReads: session.permissionFacts?.artifactReads === true,
  });
  const reply = async (id: string, response: Record<string, unknown>) => {
    await writeFrame({ type: "control_response", response: { subtype: "success", request_id: id, response } });
  };
  const handle = async (id: string, request: Record<string, unknown>) => {
    const session = read();
    const toolUseID = text(request.tool_use_id);
    const send = (response: Record<string, unknown>) => reply(id, toolUseID ? { ...response, toolUseID } : response);
    if (session.closing || !session.turn) {
      await send({ behavior: "deny", message: "Sagax: the turn ended" });
      return;
    }
    const classified = classifyPermissionPrompt(factsOf(session), request.tool_name, request.input, request.permission_suggestions);
    if (classified.kind === "deny") {
      await send({ behavior: "deny", message: classified.message });
      return;
    }
    if (classified.kind === "allow") {
      await send({ behavior: "allow", updatedInput: classified.updatedInput });
      return;
    }
    const broker = session.broker;
    if (!broker) {
      await send({ behavior: "deny", message: "Sagax: permission broker unavailable. Skip this action." });
      return;
    }
    if (classified.kind === "native-question") {
      if (!classified.questions) {
        await send({ behavior: "deny", message: ASK_USER_QUESTION_UNANSWERABLE });
        return;
      }
      const answer = await broker.hostAsk({
        id: newId(),
        kind: "question",
        tool: ASK_USER_QUESTION,
        input: { questions: classified.questions },
        at: Date.now(),
      });
      await send(nativeQuestionDecision(classified.input, classified.questions, answer));
      return;
    }
    // An ArtifactData write carries its disclosure on the card. Full access,
    // an allow rule or the bot's "ArtifactData" Always allow grant answer it
    // like any other call (server/runtime-events/request-opened.ts).
    const consent = isArtifactDataWriteConsent(classified.tool, classified.askInput);
    const disclosure = consent
      ? (text(request.description) || text(request.decision_reason) || ARTIFACT_DATA_CONSENT_FALLBACK).slice(0, DISCLOSURE_MAX)
      : undefined;
    const answer = await broker.hostAsk({
      id: newId(),
      kind: "permission",
      tool: classified.tool,
      input: asPermissionInput(classified.askInput),
      at: Date.now(),
      ...(disclosure ? { disclosure } : {}),
    });
    if (answer.behavior === "allow") {
      await send(allowPermissionResult(
        classified.updatedInput,
        classified.suggestions,
        answer.always === true,
        classified.searched,
        consent || request.suppress_always_allow_rule === true,
      ));
      return;
    }
    await send({ behavior: "deny", message: answer.message || "Denied from Sagax" });
  };
  return {
    frame(message: unknown): boolean {
      const frame = message as { type?: unknown; request_id?: unknown; request?: { subtype?: unknown } } | null;
      if (frame?.type !== "control_request" || frame.request?.subtype !== "can_use_tool" || typeof frame.request_id !== "string") return false;
      const id = frame.request_id;
      const request = frame.request as unknown as Record<string, unknown>;
      void handle(id, request).catch((error) => {
        reportBackgroundError(error);
        void reply(id, { behavior: "deny", message: "Sagax: permission prompt failed. Skip this action." });
      });
      return true;
    },
  };
}
