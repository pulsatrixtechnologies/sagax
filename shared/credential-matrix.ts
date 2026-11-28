// One map of credential form by aspect (#5180). The resolvers stay where
// they are. This table does not resolve a key and does not reorder.
// Proof: server/credentials/credential-matrix.test.ts.

import { CREDENTIAL_FORMS, type CredentialForm } from "./credential-resolver.ts";

export const CREDENTIAL_MATRIX_ASPECTS = ["text", "image", "realtime", "speech", "phone", "connector"] as const;
export type CredentialMatrixAspect = (typeof CREDENTIAL_MATRIX_ASPECTS)[number];

export interface CredentialMatrixCell {
  serves: true;
  /** The via or source the resolver returns for this form. */
  via: string;
  /** Other sources of the same form, when one form has two names. */
  also?: readonly string[];
  /** Native account connectors (`own`) or none. A key still reaches the hub. */
  account?: "own" | "none";
  where: string;
  proof: string;
  note: string;
}

const VOICE = "resolveVoiceKeys (server/voice/voice-mode.ts)";
const VOICE_PROOF = "server/voice/voice-mode.test.ts";

function voiceCell(via: string, also: readonly string[] | undefined, note: string): CredentialMatrixCell {
  return { serves: true, via, ...(also ? { also } : {}), where: VOICE, proof: VOICE_PROOF, note };
}

/** Realtime, speech and the phone line share one voice list. The phone
 * line passes `phoneLine` so a policy does not drop the later forms. */
const VOICE_ROWS: Record<CredentialForm, Pick<CredentialMatrixCell, "via" | "also" | "note">> = {
  "personal-account": { via: "grok-account", note: "The person's connected Grok account, first." },
  "personal-key": { via: "voice-key", also: ["perspicax-key"], note: "The person's voice key, then their Perspicax xAI key." },
  "org-account": { via: "org-account", note: "The organization's Grok account, after the person's forms (#5200)." },
  "org-key": { via: "org-key", note: "The organization's xAI key, when voice was given to this person." },
};

function voiceAspect(aspect: "realtime" | "speech" | "phone"): Record<CredentialForm, CredentialMatrixCell> {
  const phone = aspect === "phone";
  const out = {} as Record<CredentialForm, CredentialMatrixCell>;
  for (const form of CREDENTIAL_FORMS) {
    const row = VOICE_ROWS[form];
    out[form] = voiceCell(
      row.via,
      row.also,
      phone
        ? `${row.note} The phone line keeps it in the list (phoneLine, D-20261127-029).`
        : `${row.note} Same order. Under a policy the app asks before a paid key; the key still serves after that confirm.`,
    );
  }
  return out;
}

export const CREDENTIAL_MATRIX: Record<CredentialForm, Record<CredentialMatrixAspect, CredentialMatrixCell>> = {
  "personal-account": {
    text: {
      serves: true, via: "subscription",
      where: "resolveEngineAccess (server/engines/engine-credentials.ts)",
      proof: "server/engines/engine-credentials.test.ts",
      note: "The payer's own sign-in, before any key.",
    },
    image: {
      serves: true, via: "grok-account",
      where: "chatImageCredentials (server/media/chat-image.ts)",
      proof: "server/media/chat-image.test.ts",
      note: "Account token on the CLI image host, before keys (#5223).",
    },
    realtime: voiceAspect("realtime")["personal-account"],
    speech: voiceAspect("speech")["personal-account"],
    phone: voiceAspect("phone")["personal-account"],
    connector: {
      serves: true, via: "subscription", account: "own",
      where: "accountConnectorsForTurn (server/harness-connectors.ts)",
      proof: "server/harness-connectors.test.ts",
      note: "The person's own sign-in loads their account connectors.",
    },
  },
  "org-account": {
    text: {
      serves: true, via: "org-account",
      where: "resolveEngineAccess (server/engines/engine-credentials.ts)",
      proof: "server/engines/engine-credentials.test.ts",
      note: "Grok engines only, after the person's forms, before the org key (#5200).",
    },
    image: {
      serves: true, via: "org-account",
      where: "chatImageCredentials (server/media/chat-image.ts)",
      proof: "server/media/chat-image.test.ts",
      note: "Same host as a personal account, after the person's keys (#5200).",
    },
    realtime: voiceAspect("realtime")["org-account"],
    speech: voiceAspect("speech")["org-account"],
    phone: voiceAspect("phone")["org-account"],
    connector: {
      serves: true, via: "org-account", account: "own",
      where: "accountConnectorsForTurn (server/harness-connectors.ts)",
      proof: "server/harness-connectors.test.ts",
      note: "The organization Grok account loads account connectors for the person it was given to (#5200).",
    },
  },
  "personal-key": {
    text: {
      serves: true, via: "speaker-key",
      where: "resolveEngineAccess (server/engines/engine-credentials.ts)",
      proof: "server/engines/engine-credentials.test.ts",
      note: "The payer's own key (owner-key when the payer is the bot owner).",
    },
    image: {
      serves: true, via: "perspicax-key",
      where: "chatImageCredentials (server/media/chat-image.ts)",
      proof: "server/media/chat-image.test.ts",
      note: "The person's xAI or OpenAI key, after their account.",
    },
    realtime: voiceAspect("realtime")["personal-key"],
    speech: voiceAspect("speech")["personal-key"],
    phone: voiceAspect("phone")["personal-key"],
    connector: {
      serves: true, via: "speaker-key", account: "none",
      where: "connectorPlanFrom (server/connectors/turn-plan.ts); hub call_connector (server/connectors/hub.ts)",
      proof: "server/connectors/turn-plan.test.ts",
      note: "A key does not mount grok.com or claude.ai connectors. The hub still calls the person's own connector accounts.",
    },
  },
  "org-key": {
    text: {
      serves: true, via: "org-key",
      where: "resolveEngineAccess (server/engines/engine-credentials.ts)",
      proof: "server/engines/engine-credentials.test.ts",
      note: "The organization's key, when this engine was given to the person.",
    },
    image: {
      serves: true, via: "org-key",
      where: "chatImageCredentials (server/media/chat-image.ts)",
      proof: "server/media/chat-image.test.ts",
      note: "The organization's xAI key, when images were given to the person.",
    },
    realtime: voiceAspect("realtime")["org-key"],
    speech: voiceAspect("speech")["org-key"],
    phone: voiceAspect("phone")["org-key"],
    connector: {
      serves: true, via: "org-key", account: "none",
      where: "connectorPlanFrom (server/connectors/turn-plan.ts); hub call_connector (server/connectors/hub.ts)",
      proof: "server/connectors/turn-plan.test.ts",
      note: "A key does not mount account connectors. The hub still calls the person's own connector accounts.",
    },
  },
};

/** Every cell serves. A missing form or aspect is a hole in the map. */
export function credentialMatrixComplete(): boolean {
  for (const form of CREDENTIAL_FORMS) {
    for (const aspect of CREDENTIAL_MATRIX_ASPECTS) {
      if (CREDENTIAL_MATRIX[form][aspect]?.serves !== true) return false;
    }
  }
  return true;
}
