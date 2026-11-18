// @vitest-environment happy-dom
// Settings > Computer > Bots' computer > "Local VM (on your computer)" (owner,
// 2026-10-16): opening the row checks, then runs the one-click setup by
// itself once when a check is not ready and needs nothing from the person.
// Never an install, never a foreign container, never twice per opening, and
// the "Set up in one click" pill is gone once every check is ready. The
// desktop bridge is simulated: nothing runs on this computer.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { localVmAutoSetup, localVmReady, type DesktopLocalVm, type DesktopLocalVmStatus, type SetupJob } from "@/lib/desktop-local-vm";
import { setLocale } from "@/lib/i18n";
import { LocalVmCard } from "./OrgComputerSettings";

const bridge: DesktopBridgeStatus = {
  connected: true,
  tunnel: false,
  workplace: { place: "computer", network: "lan" },
  activity: [],
  desktops: [{ id: "d1", name: "Mac", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true } }],
};

const runtimeUp = { found: true, runtime: "docker" as const, cli: "/usr/local/bin/docker", product: "Docker Desktop", daemonUp: true, installed: ["Docker Desktop"] };
const vm = (state: string, stale: DesktopLocalVm["stale"] = null): DesktopLocalVm => ({ name: "openmausbot-computer", state, managed: stale !== "foreign", stale, folder: "/data/vm-home", folderExists: true });
const steps = (state: "done" | "running" | "error"): SetupJob["steps"] => ["runtime", "image", "container", "start"].map((id) => ({ id: id as SetupJob["steps"][number]["id"], state, detail: id === "runtime" ? "Docker Desktop" : "" }));
const status = (patch: Partial<DesktopLocalVmStatus> = {}): DesktopLocalVmStatus => ({ runtime: runtimeUp, workspace: "/data/vm-home", vm: null, setup: null, install: null, ...patch });

let desktop: DesktopLocalVmStatus;
let afterSetup: DesktopLocalVmStatus | null;
let actions: string[];
const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
  const { action } = JSON.parse(init?.body ?? "{}") as { action: string };
  actions.push(action);
  if (action === "setup" && afterSetup) desktop = afterSetup;
  const body = action === "status" || action === "setup" ? JSON.stringify(desktop) : "ok";
  return new Response(JSON.stringify({ result: { content: [{ type: "text", text: body }] } }), { status: 200, headers: { "content-type": "application/json" } });
});

let host: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
};
const open = async (allowed = true) => {
  flushSync(() => root.render(createElement(LocalVmCard, { bridge, initial: null, confirm: () => true, allowed })));
  await settle();
};
const setupPill = () => host.querySelector("[data-local-vm-setup]");

beforeEach(() => {
  setLocale("en");
  actions = [];
  afterSetup = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Local VM row sets itself up when opened", () => {
  it("checks, then runs the one-click setup once when the VM is missing, steps shown", async () => {
    desktop = status();
    afterSetup = status({ setup: { state: "running", steps: [...steps("done").slice(0, 2), { id: "container", state: "running", detail: "" }, { id: "start", state: "pending", detail: "" }], error: null, code: null, previousFolder: null } });
    await open();
    expect(actions[0]).toBe("status");
    expect(actions.filter((action) => action === "setup")).toHaveLength(1);
    const list = host.querySelector('[aria-label="Setup steps"]');
    expect(list?.querySelector('[data-step="container"]')?.getAttribute("data-step-state")).toBe("running");
    expect(list?.querySelector('[data-step="runtime"]')?.textContent).toContain("Docker Desktop");
  });

  it("does nothing when every check is ready, and only Re-check stays", async () => {
    desktop = status({ vm: vm("running"), setup: { state: "done", steps: steps("done"), error: null, code: null, previousFolder: null } });
    await open();
    expect(actions).not.toContain("setup");
    expect(setupPill()).toBeNull();
    expect(host.textContent).toContain("Re-check");
    expect(host.textContent).not.toContain("Set up in one click");
  });

  it("never installs a container engine by itself", async () => {
    desktop = status({ runtime: { found: false, runtime: null, cli: null, product: null, daemonUp: false, installed: [] } });
    await open();
    expect(actions).not.toContain("setup");
    expect(actions).not.toContain("install");
  });

  it("leaves a foreign container and a setup already under way alone", async () => {
    desktop = status({ vm: vm("running", "foreign") });
    await open();
    expect(actions).not.toContain("setup");
    flushSync(() => root.unmount());
    root = createRoot(host);
    actions = [];
    desktop = status({ setup: { state: "running", steps: steps("running"), error: null, code: null, previousFolder: null } });
    await open();
    expect(actions).not.toContain("setup");
  });

  it("respects the policy that turns the Local VM off", async () => {
    desktop = status();
    await open(false);
    expect(actions).not.toContain("setup");
  });

  it("tries once per opening: a failure shows the real error and brings the pill back", async () => {
    desktop = status();
    afterSetup = status({ setup: { state: "error", steps: [...steps("done").slice(0, 2), { id: "container", state: "error", detail: "Creating the Local VM failed: port is already allocated" }, { id: "start", state: "pending", detail: "" }], error: "Creating the Local VM failed: port is already allocated", code: "create_failed", previousFolder: null } });
    await open();
    await open();
    expect(actions.filter((action) => action === "setup")).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("port is already allocated");
    expect(setupPill()?.textContent).toContain("Try again");
  });
});

describe("localVmAutoSetup", () => {
  it("acts on a missing, stale or stopped VM and a stopped engine, not on a running, paused or blocked one", () => {
    expect(localVmAutoSetup(status(), true, null)).toBe(true);
    expect(localVmAutoSetup(status({ vm: vm("exited", "missing_folder") }), true, null)).toBe(true);
    expect(localVmAutoSetup(status({ vm: vm("exited") }), true, null)).toBe(true);
    expect(localVmAutoSetup(status({ runtime: { ...runtimeUp, daemonUp: false } }), true, null)).toBe(true);
    expect(localVmAutoSetup(status({ vm: vm("running") }), true, null)).toBe(false);
    expect(localVmAutoSetup(status({ vm: vm("paused") }), true, null)).toBe(false);
    expect(localVmAutoSetup(status({ vm: vm("exited", "foreign") }), true, null)).toBe(false);
    expect(localVmAutoSetup(status({ setup: { state: "error", steps: steps("error"), error: "Port 6080 is used by x", code: "port_in_use", previousFolder: null } }), true, null)).toBe(false);
    expect(localVmAutoSetup(status(), false, null)).toBe(false);
    expect(localVmAutoSetup(status(), true, "status")).toBe(false);
    expect(localVmAutoSetup(null, true, null)).toBe(false);
  });

  it("reads ready only when the VM runs with nothing to repair", () => {
    expect(localVmReady(status({ vm: vm("running") }), true, null)).toBe(true);
    expect(localVmReady(status({ vm: vm("exited") }), true, null)).toBe(false);
    expect(localVmReady(status(), true, null)).toBe(false);
  });
});
