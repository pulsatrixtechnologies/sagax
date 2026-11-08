import { describe, expect, it } from "vitest";
import { hostCodeCall, hostInstallCommands } from "./remote-host-agent-tools.ts";

describe("remote_support_host_code from a bot (#2714)", () => {
  it("fills org and scope, and answers the exact install line per OS", async () => {
    const sent: Array<[string, Record<string, unknown>]> = [];
    const out = await hostCodeCall({
      args: {},
      local: { dir: "/tmp/x", technicianName: "Ana Tech", orgName: "Org Name" },
      defaultOrg: "org-1",
      post: async (tool, args) => {
        sent.push([tool, args]);
        return { status: 200, body: { text: JSON.stringify({ code: "ABCD-1234", enroll_url: "https://px.example/tc/ABCD-1234/enroll", org: "org-1", scope: "full-control", expires_at: "2026-11-08T01:00:00Z" }) } };
      },
    });
    expect(sent).toEqual([["remote_support_host_code", { org: "org-1", scope: "full-control" }]]);
    expect(out.isError).toBeUndefined();
    const answer = JSON.parse(out.text);
    expect(answer.code).toBe("ABCD-1234");
    expect(answer.install_commands.linux).toBe('sudo sagax-remote-access install --unattended --org "org-1" --code "ABCD-1234" --scope full-control --consent-recorded-by "Ana Tech"');
    expect(answer.install_commands.macos).toBe(answer.install_commands.linux);
    expect(answer.install_commands.windows).toBe("sagax-remote-access.exe install --unattended --org 'org-1' --code 'ABCD-1234' --scope full-control --consent-recorded-by 'Ana Tech'");
    expect(answer.next).toContain("remote_support_hosts");
    expect(answer.host_package).toContain("sagax-remote-access#7");
  });

  it("keeps a shell-only scope and reports a refusal as is", async () => {
    const out = await hostCodeCall({
      args: { scope: "shell-only" },
      post: async (_tool, args) => {
        expect(args).toEqual({ org: "Sagax", scope: "shell-only" });
        return { status: 429, body: { error: "rate_limited: 10 codes an hour" } };
      },
    });
    expect(out).toEqual({ text: "rate_limited: 10 codes an hour", isError: true });
  });

  it("quotes PowerShell values safely", () => {
    expect(hostInstallCommands({ org: "O'Brien", code: "C", scope: "view-only", recordedBy: "" }).windows).toContain("--org 'O''Brien'");
  });
});
