// Why a pooled engine process was relaunched: the changed fields of its
// spawn contract by name, never their values; and a call's per-turn tokens
// left out of the contract (server/drivers/spawn-contract.ts).
import { describe, expect, it } from "vitest";

import { readFileSync, statSync } from "node:fs";

import { contractChanges, perspicaxTokenFile, switchesCover, turnFiles, turnSwitches, warmPerspicaxEnv, withoutTurnTokens } from "./spawn-contract.ts";

describe("spawn contract", () => {
  it("names the fields that changed, never their values", () => {
    const before = { args: ["-p"], mcpServers: { agents: { env: { SAGAX_COMMS_TOKEN: "secret-one", SAGAX_BOT_ID: "b" } } }, model: "a" };
    const after = { args: ["-p"], mcpServers: { agents: { env: { SAGAX_COMMS_TOKEN: "secret-two", SAGAX_BOT_ID: "b" } } }, model: "b" };
    const changes = contractChanges(before, after);
    expect(changes).toEqual(["mcpServers.agents.env.SAGAX_COMMS_TOKEN", "model"]);
    expect(changes.join(" ")).not.toContain("secret");
    expect(contractChanges(before, structuredClone(before))).toEqual([]);
    expect(contractChanges({ a: 1, b: 2, c: 3 }, { a: 2, b: 3, c: 4 }, 2)).toHaveLength(2);
  });

  it("masks a turn token so two turns of one call make the same contract", () => {
    const turn = (token: string) => ({ agents: { command: "node", env: { SAGAX_COMMS_TOKEN: token, SAGAX_COMMS_TOKEN_FILE: "/x" } }, ogb: { command: "node" } });
    expect(JSON.stringify(withoutTurnTokens(turn("one")))).toBe(JSON.stringify(withoutTurnTokens(turn("two"))));
    expect(JSON.stringify(withoutTurnTokens(turn("one")))).not.toContain("one");
    // the original is left as it was (it is what the process is given)
    const servers = turn("one");
    withoutTurnTokens(servers);
    expect(servers.agents.env.SAGAX_COMMS_TOKEN).toBe("one");
  });

  it("masks the turn depth and the agents switches, and says when a live process covers a turn", () => {
    const servers = (depth: string, route: string, files = true) => ({ agents: { env: {
      SAGAX_COMMS_TOKEN: `x${depth}`, SAGAX_TURN_DEPTH: depth, SAGAX_ROUTE_MESSAGES: route, SAGAX_OWN_THREAD_CREATION: route,
      ...(files ? { SAGAX_COMMS_TOKEN_FILE: "/t", SAGAX_TURN_DEPTH_FILE: "/t.depth" } : {}),
    } }, other: { env: { SAGAX_COMMS_TOKEN: "kept" } } });
    expect(JSON.stringify(withoutTurnTokens(servers("0", "1")))).toBe(JSON.stringify(withoutTurnTokens(servers("1", "0"))));
    // no files written (a full disk): the values stay in the contract
    expect(JSON.stringify(withoutTurnTokens(servers("0", "1", false)))).not.toBe(JSON.stringify(withoutTurnTokens(servers("1", "0", false))));
    // only the agents server is masked
    expect((withoutTurnTokens(servers("0", "1")).other as { env: Record<string, string> }).env.SAGAX_COMMS_TOKEN).toBe("kept");
    const launched = turnSwitches(servers("0", "1"));
    expect(switchesCover(launched, turnSwitches(servers("1", "0")))).toBe(true);
    expect(switchesCover(turnSwitches(servers("1", "0")), launched)).toBe(false);
    expect(switchesCover(undefined, turnSwitches({}))).toBe(true);
  });

  it("keeps a pre-warmed process across turns for the Perspicax account bridge: the capability rides a file", () => {
    const thread = `th-${process.pid}-${Date.now()}`;
    const bridge = (token: string) => ({ command: "node", args: ["bridge"], env: { SAGAX_PERSPICAX_TOKEN: token, SAGAX_THREAD_ID: thread } });
    const warm = { px: { ...bridge("warm-cap"), env: warmPerspicaxEnv(thread, "bot1", bridge("warm-cap").env) } };
    const file = perspicaxTokenFile(thread, "bot1");
    expect(warm.px.env.SAGAX_PERSPICAX_TOKEN_FILE).toBe(file);
    expect(readFileSync(file, "utf8")).toBe("warm-cap");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const turn = { px: { ...bridge("turn-cap"), env: warmPerspicaxEnv(thread, "bot1", bridge("turn-cap").env) } };
    // the same contract: the warm process is the one the turn takes
    expect(JSON.stringify(withoutTurnTokens(warm))).toBe(JSON.stringify(withoutTurnTokens(turn)));
    expect(JSON.stringify(withoutTurnTokens(turn))).not.toContain("cap");
    // the file now holds this turn's capability, which the bridge reads per frame
    expect(readFileSync(file, "utf8")).toBe("turn-cap");
    expect(turnFiles(turn)).toEqual([file]);
    // another bot, another file
    expect(perspicaxTokenFile(thread, "bot2")).not.toBe(file);
    // without a file the value stays in the contract (a relaunch, never a stale capability)
    expect(JSON.stringify(withoutTurnTokens({ px: bridge("one") }))).not.toBe(JSON.stringify(withoutTurnTokens({ px: bridge("two") })));
  });

  it("masks the agents turn values behind the tool gate, and reads the switches through it", () => {
    const inner = (token: string, hop: string) => ({ SAGAX_COMMS_TOKEN: token, SAGAX_COMMS_TOKEN_FILE: "/t", SAGAX_TURN_DEPTH: hop, SAGAX_TURN_DEPTH_FILE: "/t.depth", SAGAX_PEER_HOP: hop, SAGAX_ROUTE_MESSAGES: hop === "1" ? "0" : "1" });
    const gated = (token: string, hop: string) => ({ agents: { command: "node", env: { SAGAX_GATE_NAME: "agents", SAGAX_GATE_UPSTREAM: JSON.stringify({ command: "node", args: ["agents.js"], env: inner(token, hop) }) } } });
    expect(JSON.stringify(withoutTurnTokens(gated("one", "0")))).toBe(JSON.stringify(withoutTurnTokens(gated("two", "1"))));
    expect(JSON.stringify(withoutTurnTokens(gated("one", "0")))).not.toContain("one");
    const config = (token: string) => ({ agents: { env: { SAGAX_GATE_CONFIG_abc: JSON.stringify({ SAGAX_GATE_UPSTREAM: JSON.stringify({ command: "node", env: inner(token, "0") }) }) } } });
    expect(JSON.stringify(withoutTurnTokens(config("one")))).toBe(JSON.stringify(withoutTurnTokens(config("two"))));
    expect(turnSwitches(gated("x", "0"))).toMatchObject({ SAGAX_ROUTE_MESSAGES: true, SAGAX_PEER_TOOLS: true });
    expect(turnFiles(gated("x", "0"))).toEqual(["/t", "/t.depth"]);
    // a person's process serves a teammate's reply; never the other way round
    expect(switchesCover(turnSwitches(gated("x", "0")), turnSwitches(gated("y", "1")))).toBe(true);
    expect(switchesCover(turnSwitches(gated("x", "1")), turnSwitches(gated("y", "0")))).toBe(false);
  });
});
