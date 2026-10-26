import { describe, expect, it } from "vitest";

import { remoteSessionReach } from "./remote-session-reach.ts";

const open = () => ({ host: "MacBook de Lucie", os: "macos" as const, known: true });
const base = { botId: "bot-1", threadId: "thread-1", ownerPrincipalId: "owner", speakerPrincipalId: "owner", payerPrincipalId: "owner" };

describe("remote session reach", () => {
  it("names the two tools to the owner speaking and paying, outside a room, while a session is open", () => {
    expect(remoteSessionReach(open)(base)).toEqual({
      line: "A Tailcat remote session is open on MacBook de Lucie (macOS): remote_session_snapshot reads it in one call, remote_session_exec runs one command",
      tools: ["agents__remote_session_snapshot", "agents__remote_session_exec"],
    });
    expect(remoteSessionReach(() => ({ host: "8F2NZU", os: "windows", known: false }))(base)?.line).toContain("OS not known yet");
  });

  it("gives nothing to anyone else, in a room, to an unknown speaker, or without a session", () => {
    const reach = remoteSessionReach(open);
    expect(reach({ ...base, speakerPrincipalId: "member", payerPrincipalId: "member" })).toBeNull();
    expect(reach({ ...base, payerPrincipalId: "someone-else" })).toBeNull();
    expect(reach({ ...base, room: true })).toBeNull();
    expect(reach({ ...base, speakerPrincipalId: undefined })).toBeNull();
    expect(reach({ ...base, payerPrincipalId: undefined })).toBeNull();
    expect(remoteSessionReach(() => null)(base)).toBeNull();
  });

  it("asks the sessions of the speaker, for this bot and conversation", () => {
    const seen: unknown[] = [];
    remoteSessionReach((input) => { seen.push(input); return null; })({ ...base, speakerPrincipalId: "Owner", ownerPrincipalId: "owner", payerPrincipalId: "OWNER" });
    expect(seen).toEqual([{ principalId: "owner", botId: "bot-1", threadId: "thread-1" }]);
  });
});
