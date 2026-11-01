import { describe, expect, it, vi } from "vitest";

import { createRemoteBotHosts } from "./remote-bot-hosts.ts";
import type { UnattendedHostRow } from "../shared/remote-unattended-host.ts";

const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"cd".repeat(16)}`;
const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const ALICE_SUB = "sub-alice";
const BOB_SUB = "sub-bob";

const enrolled = (over: Partial<UnattendedHostRow> = {}): UnattendedHostRow => ({
  hostId: HOST,
  hostname: "PC-A",
  org: null,
  scope: "full-control",
  installedBy: ALICE_SUB,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-30T00:00:00.000Z",
  lastSeenAt: null,
  revokedAt: null,
  state: "enrolled",
  ...over,
});

function make(opts: {
  aliceHosts?: UnattendedHostRow[];
  bobHosts?: UnattendedHostRow[];
  /** When set, Perspicax still lists every host (the bug assertOwnHost must survive). */
  allHosts?: UnattendedHostRow[];
  bots?: Record<string, { id: string; remoteHosts?: string[]; ownerPrincipalId?: string | null }>;
  ownerSub?: (principalId: string) => string | null;
} = {}) {
  const bots = { ...(opts.bots ?? { melonie: { id: "melonie", remoteHosts: [], ownerPrincipalId: ALICE } }) };
  const save = vi.fn((botId: string, remoteHosts: string[]) => {
    bots[botId] = { ...bots[botId]!, remoteHosts };
  });
  const open = vi.fn(async () => ({ ok: true as const, code: "K7QMNP", botId: "melonie", threadId: "t1" }));
  const service = createRemoteBotHosts({
    bot: (id) => bots[id] ?? null,
    canEdit: (principalId, botId) => bots[botId]?.ownerPrincipalId?.toLowerCase() === principalId.toLowerCase(),
    save,
    ownerSub: opts.ownerSub ?? ((principalId) => {
      if (principalId === ALICE) return ALICE_SUB;
      if (principalId === BOB) return BOB_SUB;
      return null;
    }),
    hosts: {
      list: async ({ principalId }) => {
        if (opts.allHosts) return { available: true as const, hosts: opts.allHosts };
        if (principalId === ALICE) return { available: true as const, hosts: opts.aliceHosts ?? [enrolled()] };
        if (principalId === BOB) return { available: true as const, hosts: opts.bobHosts ?? [enrolled({ hostId: OTHER, hostname: "Bob-PC", installedBy: BOB_SUB })] };
        return { available: false as const, hosts: [], reason: "no seat" };
      },
      open,
      revoke: vi.fn(async () => ({ ok: true as const })),
    },
  });
  return { service, save, open, bots };
}

describe("remote bot hosts (endpoint-to-bot access)", () => {
  it("attaches a person's enrolled host to their bot by default", async () => {
    const { service, save, bots } = make();
    const out = await service.attach(ALICE, "melonie", HOST);
    expect(out).toEqual({ ok: true, remoteHosts: [HOST] });
    expect(save).toHaveBeenCalledWith("melonie", [HOST]);
    expect(bots.melonie?.remoteHosts).toEqual([HOST]);
    const listed = await service.forBot(ALICE, "melonie");
    expect(listed.attached).toEqual([HOST]);
    expect(listed.hosts.map((h) => h.hostname)).toEqual(["PC-A"]);
  });

  it("isolates hosts: Alice cannot attach Bob's host, nor edit Bob's bot", async () => {
    const { service, save } = make({
      aliceHosts: [enrolled()],
      bobHosts: [enrolled({ hostId: OTHER, hostname: "Bob-PC", installedBy: BOB_SUB })],
      bots: {
        melonie: { id: "melonie", remoteHosts: [], ownerPrincipalId: ALICE },
        bobBot: { id: "bobBot", remoteHosts: [], ownerPrincipalId: BOB },
      },
    });
    expect(await service.attach(ALICE, "melonie", OTHER)).toMatchObject({ ok: false, error: "not_found" });
    expect(await service.attach(ALICE, "bobBot", HOST)).toMatchObject({ ok: false, error: "forbidden" });
    expect(save).not.toHaveBeenCalled();
  });

  it("filters ownership when Perspicax lists every host of the org", async () => {
    const { service, open } = make({
      allHosts: [
        enrolled(),
        enrolled({ hostId: OTHER, hostname: "Bob-PC", installedBy: BOB_SUB }),
      ],
      bots: { melonie: { id: "melonie", remoteHosts: [OTHER], ownerPrincipalId: ALICE } },
    });
    expect(await service.attach(ALICE, "melonie", OTHER)).toMatchObject({ ok: false, error: "not_found" });
    const catalog = await service.forBot(ALICE, "melonie");
    expect(catalog.catalog.map((h) => h.hostId)).toEqual([HOST]);
    expect(catalog.hosts).toEqual([]);
    expect(await service.open(ALICE, "melonie", OTHER)).toMatchObject({ ok: false, error: "not_found" });
    expect(open).not.toHaveBeenCalled();
  });

  it("detaches and refuses open until the host is attached", async () => {
    const { service, open } = make();
    expect(await service.open(ALICE, "melonie", HOST)).toMatchObject({ ok: false, error: "not_found" });
    expect(open).not.toHaveBeenCalled();
    await service.attach(ALICE, "melonie", HOST);
    expect(await service.open(ALICE, "melonie", HOST)).toEqual({ ok: true, code: "K7QMNP", botId: "melonie", threadId: "t1" });
    expect(open).toHaveBeenCalledWith({ principalId: ALICE }, HOST, {});
    expect(await service.detach(ALICE, "melonie", HOST)).toEqual({ ok: true, remoteHosts: [] });
  });
});
