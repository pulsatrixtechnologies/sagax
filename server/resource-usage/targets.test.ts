import { describe, expect, it } from "vitest";

import type { TerminalAccess } from "../terminal-resources/types.ts";
import type { SampleSource } from "./sampler.ts";
import { resolveResourceTarget, type ResourceSessionEntry, type ResourceTargetDeps } from "./targets.ts";

const source = (name: string): SampleSource & { name: string } => ({ name, start: () => ({ stop() {} }) });

function deps(overrides: Partial<ResourceTargetDeps> & { accessOf?: Record<string, Partial<TerminalAccess>> } = {}) {
  const sessions: Record<string, ResourceSessionEntry[]> = {
    "pr_a|b1": [
      { id: "0123456789ab", code: "BQDHS7", hostname: "POSTE-01", os: "windows", threadId: "t1" },
      { id: "ba9876543210", code: "ZZ12AB", hostname: "POSTE-02", os: "windows", threadId: "t9", focused: true },
    ],
  };
  const tunnels = new Set(["0123456789ab", "ba9876543210"]);
  const base: ResourceTargetDeps = {
    organization: () => true,
    desktopManaged: () => false,
    access: (principalId) => ({ organization: true, admin: false, ownsBot: false, ...overrides.accessOf?.[principalId] }),
    owner: () => "pr_a",
    localHostname: () => "sagax-prod",
    localSource: () => source("local"),
    hosts: () => [
      { id: "srv01", provider: "ssh", label: "Serveur web", hostLabel: "srv01", alias: "srv01" },
      { id: "default", provider: "unraid", label: "Serveur unRAID", hostLabel: "fs01", alias: "fs01" },
    ],
    sshSource: (alias) => source(`ssh:${alias}`),
    remoteSessions: (principalId, botId) => sessions[`${principalId}|${botId}`] ?? [],
    tailcatSource: (entry) => (tunnels.has(entry.id) ? source(`tailcat:${entry.code}`) : null),
    ...overrides,
  };
  return { deps: base, sessions, tunnels };
}

const ask = (target: Parameters<typeof resolveResourceTarget>[1]["target"], extra: Partial<Parameters<typeof resolveResourceTarget>[1]> = {}) => ({
  principalId: "pr_a", botId: "b1", threadId: "t1", target, ...extra,
});

async function opened(result: Awaited<ReturnType<typeof resolveResourceTarget>>) {
  if ("error" in result) throw new Error(result.error);
  const got = await result.open();
  return "error" in got ? got : (got as unknown as { name: string }).name;
}

describe("resource targets: the existing rules decide", () => {
  it("server hosts open for an admin or a holder of host.commands, never for a member", async () => {
    const { deps: member } = deps();
    const refused = await resolveResourceTarget(member, ask("host", { host: "srv01" }));
    expect(refused).toMatchObject({ code: "forbidden" });

    const { deps: admin } = deps({ accessOf: { pr_a: { admin: true } } });
    const host = await resolveResourceTarget(admin, ask("host", { host: "Serveur unRAID" }));
    expect("view" in host && host.view).toEqual({ target: "host", label: "Serveur unRAID", hostLabel: "fs01" });
    expect(await opened(host)).toBe("ssh:fs01");

    const { deps: granted } = deps({ accessOf: { pr_a: { serverHosts: true } } });
    expect(await opened(await resolveResourceTarget(granted, ask("host", { host: "srv01" })))).toBe("ssh:srv01");
  });

  it("names the hosts it knows when the bot guessed wrong", async () => {
    const { deps: admin } = deps({ accessOf: { pr_a: { admin: true } } });
    const unknown = await resolveResourceTarget(admin, ask("host", { host: "nope" }));
    expect(unknown).toMatchObject({ code: "unknown" });
    expect("error" in unknown && unknown.error).toContain("Serveur web (srv01)");
  });

  it("checks again on Reprendre: a right taken away stops the next run", async () => {
    let admin = true;
    const { deps: base } = deps();
    const live: ResourceTargetDeps = { ...base, access: () => ({ organization: true, admin, ownsBot: false }) };
    const host = await resolveResourceTarget(live, ask("host", { host: "srv01" }));
    admin = false;
    expect(await opened(host)).toEqual({ error: "forbidden" });
  });

  it("a Tailcat session is only its owner's, with the same bot, while its tunnel resolves", async () => {
    const { deps: base, tunnels, sessions } = deps();
    // another person, or the same person with another bot: nothing
    expect(await resolveResourceTarget(base, { ...ask("remote_session"), principalId: "pr_b" })).toMatchObject({ code: "unknown" });
    expect(await resolveResourceTarget(base, { ...ask("remote_session"), botId: "b2" })).toMatchObject({ code: "unknown" });

    // by default: this conversation's session
    const here = await resolveResourceTarget(base, ask("remote_session"));
    expect("view" in here && here.view).toEqual({ target: "remote-session", label: "Session à distance", hostLabel: "POSTE-01" });
    // by its support code or its computer name
    const byCode = await resolveResourceTarget(base, ask("remote_session", { session: "zz1-2ab" }));
    expect(await opened(byCode)).toBe("tailcat:ZZ12AB");
    const byName = await resolveResourceTarget(base, ask("remote_session", { session: "poste-02" }));
    expect("view" in byName && byName.view.hostLabel).toBe("POSTE-02");

    // the session closes before Reprendre
    sessions["pr_a|b1"] = sessions["pr_a|b1"]!.filter((row) => row.code !== "ZZ12AB");
    expect(await opened(byCode)).toEqual({ error: "gone" });

    // the tunnel is not on this host
    tunnels.clear();
    expect(await resolveResourceTarget(base, ask("remote_session"))).toMatchObject({ code: "unavailable" });
  });

  it("this computer: the solo operator only; an organization says it is not offered yet", async () => {
    const { deps: org } = deps({ accessOf: { pr_a: { admin: true } } });
    expect(await resolveResourceTarget(org, ask("this_computer"))).toMatchObject({ code: "unavailable" });
    // the Sagax server itself: an organization admin
    const server = await resolveResourceTarget(org, ask("sagax_server"));
    expect("view" in server && server.view).toEqual({ target: "server", label: "Serveur Sagax", hostLabel: "sagax-prod" });
    const { deps: member } = deps();
    expect(await resolveResourceTarget(member, ask("sagax_server"))).toMatchObject({ code: "forbidden" });

    const { deps: solo } = deps({ organization: () => false, desktopManaged: () => true, accessOf: { pr_a: { organization: false, admin: true, ownsBot: true } } });
    const mine = await resolveResourceTarget(solo, ask("this_computer"));
    expect("view" in mine && mine.view.label).toBe("Ce poste");
    expect(await opened(mine)).toBe("local");
  });

  it("the bot's computer: its owner (or an admin) only, and only when it runs here", async () => {
    const vm = async () => ({ hostLabel: "sagax-vm-b1", source: source("vm") });
    const { deps: none } = deps({ accessOf: { pr_a: { ownsBot: true } } });
    expect(await resolveResourceTarget(none, ask("bot_computer"))).toMatchObject({ code: "unavailable" });
    const { deps: stranger } = deps({ botComputer: vm });
    expect(await resolveResourceTarget(stranger, ask("bot_computer"))).toMatchObject({ code: "forbidden" });
    const { deps: owner } = deps({ botComputer: vm, accessOf: { pr_a: { ownsBot: true } } });
    expect(await opened(await resolveResourceTarget(owner, ask("bot_computer")))).toBe("vm");
  });
});
