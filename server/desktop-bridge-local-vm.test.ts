// POST /api/me/desktop-bridge/local-vm: the person's own Local VM on their
// connected computer. Only the listed actions pass; setup carries this
// server's own recipe for the desktop to check and fill in.
import { describe, expect, it } from "vitest";

import { DESKTOP_WORKSPACE_PLACEHOLDER, REAL_CONTAINER } from "./computer/container-computer.ts";
import { desktopBridgeCapability, type DesktopBridgeOperation } from "./desktop-bridge.ts";
import { createDesktopBridgeRoutes } from "./desktop-bridge-routes.ts";

function call(body: unknown) {
  const sent: DesktopBridgeOperation[] = [];
  const picked: (string | undefined)[] = [];
  const routes = createDesktopBridgeRoutes({
    organization: () => true,
    bridges: { request: async (_person: string, operation: DesktopBridgeOperation, _active: unknown, _progress: unknown, desktopId?: string) => { sent.push(operation); picked.push(desktopId); return { content: [{ type: "text", text: "ok" }] }; } } as never,
    tunnels: {} as never,
    audit: { record() {}, recent: () => [] } as never,
    workplace: () => ({}),
  });
  let answer: { status: number; body: Record<string, unknown> } | undefined;
  const done = routes({
    req: { headers: { "content-type": "application/json" } },
    res: { setHeader() {} },
    path: "/api/me/desktop-bridge/local-vm",
    method: "POST",
    auth: { kind: "session", session: { id: "s1", principalId: "Ada" } },
    json: (_res: unknown, status: number, value: Record<string, unknown>) => { answer = { status, body: value }; },
    readBody: async () => body,
  } as never);
  return Promise.resolve(done).then(() => ({ answer: answer!, sent, picked }));
}

describe("the person's Local VM route", () => {
  it("maps each Computer tab action to its bridge operation", async () => {
    for (const [action, operation] of [["status", "vm_status"], ["start", "vm_start"], ["stop", "vm_stop"], ["pause", "vm_pause"], ["resume", "vm_resume"], ["screenshot", "vm_screenshot"]] as const) {
      const { answer, sent } = await call({ action });
      expect(answer.status).toBe(200);
      expect(sent).toEqual([{ action: operation }]);
      expect(desktopBridgeCapability(operation)).toBe("localVm");
    }
  });

  it("sends setup with the server's recipe and install with only the choice", async () => {
    const setup = await call({ action: "setup", spec: { evil: true } });
    const spec = (setup.sent[0]!.arguments as { spec: { container: string; run: { docker: string[] } } }).spec;
    expect(setup.sent[0]!.action).toBe("vm_setup");
    expect(spec.container).toBe(REAL_CONTAINER);
    expect(spec.run.docker.join(" ")).toContain(`source=${DESKTOP_WORKSPACE_PLACEHOLDER},`);
    expect(JSON.stringify(spec)).not.toContain("evil");
    const install = await call({ action: "install", choice: "orbstack-download", url: "https://evil.test" });
    expect(install.sent).toEqual([{ action: "vm_install", arguments: { choice: "orbstack-download" } }]);
  });

  it("passes the computer the person picked, and refuses a malformed one", async () => {
    const id = "0f8e2a4c-6b1d-4e3f-9a7b-5c2d1e0f9a8b";
    expect((await call({ action: "status" })).picked).toEqual([undefined]);
    expect((await call({ action: "status", desktopId: id })).picked).toEqual([id]);
    for (const desktopId of ["../x", "", 7, "0F8E2A4C"]) {
      const { answer, sent } = await call({ action: "status", desktopId });
      expect(answer.status).toBe(400);
      expect(sent).toEqual([]);
    }
  });

  it("refuses anything else", async () => {
    for (const action of ["run_command", "use", "vm_computer_call", "__proto__", "toString", 3]) {
      const { answer, sent } = await call({ action });
      expect(answer.status).toBe(400);
      expect(sent).toEqual([]);
    }
  });
});
