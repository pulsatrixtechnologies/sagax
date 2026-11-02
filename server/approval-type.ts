// What kind of approval a pending card is, for the Perspicax console
// (pending list, sagax_approve). Only "tool" cards are decidable there;
// everything else is answered in Sagax itself.
import type { ApprovalType } from "./org-admin-routes.ts";
import type { OptionCardData } from "../shared/wire.ts";

export function approvalTypeOf(card: Pick<OptionCardData, "skillRequest" | "routineRequest" | "profileRequest" | "modelRequest" | "ruleRequest" | "teamSetupRequest" | "meetingRequest" | "allowKey" | "tool" | "commandAllowlist" | "approvalScope">): ApprovalType {
  // A meeting's consent card is the person's own tap in the chat, every
  // time: never the console's, never an "Allow" by proxy.
  if (card.meetingRequest) return "other";
  if (card.skillRequest) return "skill";
  if (card.routineRequest) return "routine";
  if (card.profileRequest) return "profile";
  if (card.modelRequest) return "model";
  // Answered in Sagax itself (like profile / model), never the console.
  if (card.ruleRequest) return "other";
  if (card.teamSetupRequest) return "team_setup";
  if (card.allowKey && !card.allowKey.startsWith("mcp:")) return "peer";
  if (card.tool || card.commandAllowlist || card.approvalScope) return "tool";
  return "other";
}
