import { t } from "@/lib/i18n";
import type { VoiceModeRefusalCause } from "../../../shared/voice-mode";

/** The access card of a refused voice turn: shown in the speaker's own bar
 * only (the audience of every access card), never in the thread. */
export interface VoiceAccessCard {
  cause: VoiceModeRefusalCause;
  admin: boolean;
  keysUrl?: string;
}

/** What the card says, to the person it is about. Exported for tests. */
export function voiceAccessCardText(card: VoiceAccessCard): string[] {
  if (card.cause === "payer_disabled") return [t("voiceMode.noAccess.disabled")];
  if (card.cause === "perspicax_unreachable") return [t("voiceMode.noAccess.unreachable")];
  if (card.cause === "server_engine_not_allowed") return [t("voiceMode.noAccess.notGiven")];
  return [t("voiceMode.noAccess.xaiKey"), ...(card.admin ? [t("access.noAccess.mine.admin")] : [])];
}
