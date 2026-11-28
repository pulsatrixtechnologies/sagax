// #5180: every form serves every aspect. The map is shared/credential-matrix.ts.
import { describe, expect, it } from "vitest";

import { CREDENTIAL_FORMS, type CredentialForm } from "../../shared/credential-resolver.ts";
import { CREDENTIAL_MATRIX, CREDENTIAL_MATRIX_ASPECTS, credentialMatrixComplete } from "../../shared/credential-matrix.ts";
import { resolveEngineAccess, type EngineCredentialInput } from "../engines/engine-credentials.ts";
import { accountConnectorsForTurn, type ClaudeAiTurnInput } from "../harness-connectors.ts";
import { connectorPlanFrom } from "../connectors/turn-plan.ts";
import { chatImageCredentials } from "../media/chat-image.ts";
import { resolveVoiceKeys } from "../voice/voice-mode.ts";
import type { AccessVia } from "../engines/engine-credentials.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const ADA = "pr_00000000-0000-4000-8000-00000000000a";
const BEN = "pr_00000000-0000-4000-8000-00000000000b";

function engine(patch: Partial<EngineCredentialInput> = {}): EngineCredentialInput {
  return {
    identity: "perspicax",
    speaker: { origin: "person", principalId: ADA },
    owner: { principalId: OWNER, sub: "SUB-OWNER" },
    instance: { instanceId: "grok", driver: "grokAgent", installed: true },
    person: (id) => (id === ADA ? { sub: "SUB-ADA" } : id === OWNER ? { sub: "SUB-OWNER" } : undefined),
    subscriptionSignedIn: () => false,
    hasKey: () => false,
    keyBacked: false,
    ...patch,
  };
}

function turn(via: AccessVia): ClaudeAiTurnInput {
  return {
    identity: "perspicax", restrictedByPolicy: false, driver: "grokAgent", instanceId: "grok",
    via, payerPrincipalId: ADA, speaker: { origin: "person", principalId: ADA },
    ownerPrincipalId: ADA, localPrincipalId: "", grokAccountConnectors: true,
  };
}

describe("credential matrix (#5180)", () => {
  it("names every form and every aspect, and each cell serves", () => {
    expect(credentialMatrixComplete()).toBe(true);
    expect(Object.keys(CREDENTIAL_MATRIX).sort()).toEqual([...CREDENTIAL_FORMS].sort());
    for (const form of CREDENTIAL_FORMS) {
      expect(Object.keys(CREDENTIAL_MATRIX[form]).sort()).toEqual([...CREDENTIAL_MATRIX_ASPECTS].sort());
      for (const aspect of CREDENTIAL_MATRIX_ASPECTS) {
        const cell = CREDENTIAL_MATRIX[form][aspect];
        expect(cell.serves, `${form} ${aspect}`).toBe(true);
        expect(cell.where.length).toBeGreaterThan(0);
        expect(cell.proof.length).toBeGreaterThan(0);
      }
    }
  });

  it("text: each form is the via resolveEngineAccess returns", () => {
    const cases: Array<[EngineCredentialInput, CredentialForm]> = [
      [engine({ subscriptionSignedIn: (id, driver) => id === ADA && driver === "grokAgent" }), "personal-account"],
      [engine({ hasKey: (sub, provider) => sub === "SUB-ADA" && provider === "xai" }), "personal-key"],
      [engine({ orgAccountAvailable: true, orgAccountPrincipalId: OWNER }), "org-account"],
      [engine({ keyBacked: true }), "org-key"],
    ];
    for (const [input, form] of cases) {
      const plan = resolveEngineAccess(input);
      expect(plan.ok, form).toBe(true);
      if (!plan.ok) continue;
      expect(plan.via).toBe(CREDENTIAL_MATRIX[form].text.via);
    }
  });

  it("image: the chain holds an account, the person's key, the org account, then the org key", async () => {
    const chain = await chatImageCredentials({
      organization: true,
      personal: async (provider) => ({ ok: true, key: provider === "xai" ? "person-xai-0002" : "person-oai-0003", fingerprint: "f" }),
      solo: async () => undefined,
      account: async () => "acct-token-0001",
      orgAccount: async () => "org-acct-token05",
      organizationXaiAllowed: () => true,
      organizationXaiKey: () => "org-key-00000004",
    });
    expect(Array.isArray(chain)).toBe(true);
    if (!Array.isArray(chain)) return;
    const sources = chain.map((entry) => entry.source);
    for (const form of CREDENTIAL_FORMS) {
      expect(sources, form).toContain(CREDENTIAL_MATRIX[form].image.via);
    }
    expect(sources).toEqual(["grok-account", "perspicax-key", "perspicax-key", "org-account", "org-key"]);
  });

  it("voice: realtime and speech share the order, and a phone line keeps it under a policy", async () => {
    for (const form of CREDENTIAL_FORMS) {
      for (const aspect of ["realtime", "speech", "phone"] as const) {
        expect(CREDENTIAL_MATRIX[form][aspect].via).toBe(CREDENTIAL_MATRIX[form].realtime.via);
      }
    }
    const policy = { aspect: "voice" as const, personalKeysEnabled: true, allowPersonalWhenActingAs: false, paidKeyConfirmed: false };
    const deps = {
      organization: true,
      serverKey: () => "xai-ORG-matrix-0004",
      hasOwnKey: (sub: string) => sub === "sub-ada",
      resolveOwnKey: async (sub: string) => (sub === "sub-ada" ? { ok: true as const, key: "xai-ADA-perspicax-0003", fingerprint: "fp" } : { ok: false as const, error: "no_key" as const }),
      personalKey: (speaker: { principalId: string }) => (speaker.principalId === ADA ? "xai-ADA-voice-0002" : "xai-BEN-voice-not-ada"),
      grokAccount: async (speaker: { principalId: string }) => (speaker.principalId === ADA ? "grk-ADA-account-0001" : "grk-BEN-account-not-ada"),
      orgAccount: async () => "grk-ORG-account-0005",
      credentialPolicy: () => policy,
    };
    const open = await resolveVoiceKeys(deps, { principalId: ADA, sub: "sub-ada" });
    const line = await resolveVoiceKeys(deps, { principalId: ADA, sub: "sub-ada" }, undefined, { phoneLine: true });
    expect(open.ok && open.keys.map((key) => key.source)).toEqual(["grok-account", "org-account"]);
    expect(line.ok && line.keys.map((key) => key.source)).toEqual(["grok-account", "voice-key", "perspicax-key", "org-account", "org-key"]);
    const sources = line.ok ? line.keys.map((key) => key.source) : [];
    for (const form of CREDENTIAL_FORMS) {
      const cell = CREDENTIAL_MATRIX[form].phone;
      expect(sources, form).toContain(cell.via);
      for (const extra of cell.also ?? []) expect(sources, extra).toContain(extra);
    }
    expect(JSON.stringify(line)).not.toContain("BEN");
    expect(JSON.stringify(line)).not.toContain(BEN);
  });

  it("connectors: an account loads them, a key does not, and the person stays the hub principal", () => {
    for (const form of CREDENTIAL_FORMS) {
      const cell = CREDENTIAL_MATRIX[form].connector;
      const via = cell.via as AccessVia;
      expect(accountConnectorsForTurn(turn(via)), form).toBe(cell.account);
      const plan = connectorPlanFrom(turn(via), { withholdsHostTools: true });
      expect(plan.principal, form).toBe(ADA);
      if (cell.account === "none") expect(plan.account).toBe("none");
    }
    expect(accountConnectorsForTurn({ ...turn("subscription"), payerPrincipalId: BEN })).toBe("foreign");
  });
});
