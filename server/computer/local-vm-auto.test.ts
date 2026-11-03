import { describe, expect, it, vi } from "vitest";

import type { ContainerComputerStatus } from "./container-computer.ts";
import { LOCAL_VM_AUTO_BACKOFF_MS, LocalVmAutoStarter, localVmNeedsRecreate, type LocalVmAutoDeps } from "./local-vm-auto.ts";

function vm(patch: Partial<ContainerComputerStatus> = {}): ContainerComputerStatus {
  return {
    platform: "darwin", runtime: "podman", available: ["podman"], daemonUp: true, image: true, imageMatches: true, managed: true,
    container: "running", network: "loopback", security: "hardened", persistence: "durable", desktopReady: true, desktop_error: null,
    resumable: false, create_supported: true, ready: true, problem: null, image_ref: "img", image_id: "id", base_image_ref: "base",
    driver_version: "0.20.0", container_name: "openmausbot-computer", target_key: "shared", workspace_path: "/tmp/vm-home",
    workspace_guest_path: "/home/cua/workspace", viewer_port: 6080, viewer_url: "http://127.0.0.1:6080/vnc.html",
    ...patch,
  };
}

/** A fake computer: one status the actions move along, and a clock. */
function harness(initial: ContainerComputerStatus, overrides: Partial<LocalVmAutoDeps> = {}) {
  let current = initial;
  let clock = 1_000;
  const timers: { run: () => void; at: number }[] = [];
  const calls: string[] = [];
  const deps: LocalVmAutoDeps = {
    mode: () => "shared",
    allowed: () => true,
    status: async () => current,
    startRuntime: async () => { calls.push("startRuntime"); current = { ...current, daemonUp: true }; return true; },
    prepareImage: async () => { calls.push("pull"); current = { ...current, image: true }; },
    create: async () => { calls.push("create"); current = vm(); return current; },
    start: async () => { calls.push("start"); current = vm(); return current; },
    remove: async () => { calls.push("remove"); current = vm({ container: "missing", ready: false, managed: false }); return current; },
    busy: () => false,
    wait: async (ms) => { clock += ms; },
    now: () => clock,
    schedule: (run, ms) => { const timer = { run, at: clock + ms }; timers.push(timer); return timer; },
    cancel: (handle) => { const index = timers.indexOf(handle as never); if (index >= 0) timers.splice(index, 1); },
    desktopWaitMs: 10_000,
    runtimeWaitMs: 10_000,
    ...overrides,
  };
  return {
    auto: new LocalVmAutoStarter(deps),
    calls,
    timers,
    set: (next: ContainerComputerStatus) => { current = next; },
    get: () => current,
    advance: (ms: number) => { clock += ms; },
  };
}

describe("Local VM automatic start", () => {
  it("creates a missing shared VM at launch and reports it running", async () => {
    const h = harness(vm({ container: "missing", ready: false, managed: false }));
    const result = await h.auto.ensure("launch");
    expect(h.calls).toEqual(["create"]);
    expect(result).toMatchObject({ phase: "running", problem: null, attempts: 0 });
  });

  it("starts a stopped VM at launch", async () => {
    const h = harness(vm({ container: "stopped", ready: false, resumable: true }));
    await h.auto.ensure("launch");
    expect(h.calls).toEqual(["start"]);
    expect(h.auto.snapshot().phase).toBe("running");
  });

  it("does nothing to a running VM", async () => {
    const h = harness(vm());
    await h.auto.ensure("launch");
    expect(h.calls).toEqual([]);
    expect(h.auto.snapshot().phase).toBe("running");
  });

  it("starts the runtime once, prepares the image once, then creates the VM", async () => {
    const h = harness(vm({ daemonUp: false, image: false, container: "missing", ready: false, managed: false }));
    await h.auto.ensure("launch");
    expect(h.calls).toEqual(["startRuntime", "pull", "create"]);
    expect(h.auto.snapshot().phase).toBe("running");
  });

  it("recreates a managed VM of an older image and never touches a foreign container", async () => {
    const old = harness(vm({ imageMatches: false, ready: false }));
    await old.auto.ensure("launch");
    expect(old.calls).toEqual(["remove", "create"]);

    const foreign = harness(vm({ managed: false, ready: false }));
    const result = await foreign.auto.ensure("launch");
    expect(foreign.calls).toEqual([]);
    expect(result).toMatchObject({ phase: "problem", problem: "foreign", nextRetryAt: null });
    expect(foreign.timers).toHaveLength(0);
    expect(localVmNeedsRecreate(vm({ managed: false, imageMatches: false }))).toBe(false);
  });

  it("does not start a VM the person stopped in this session, until their own start", async () => {
    const h = harness(vm({ container: "stopped", ready: false, resumable: true }));
    h.auto.personStopped();
    expect(await h.auto.ensure("launch")).toMatchObject({ phase: "stopped", stoppedByPerson: true });
    expect(await h.auto.ensure("bot")).toMatchObject({ phase: "stopped" });
    expect(h.calls).toEqual([]);
    await h.auto.ensure("person");
    expect(h.calls).toEqual(["start"]);
    expect(h.auto.snapshot()).toMatchObject({ phase: "running", stoppedByPerson: false });
  });

  it("retries a failed start with a growing delay, then stops and waits for the person", async () => {
    const start = vi.fn(async () => { throw new Error("podman start exited 125"); });
    const h = harness(vm({ container: "stopped", ready: false, resumable: true }), { start });
    const scheduled = () => h.timers.map((timer) => timer.at);
    let result = await h.auto.ensure("launch");
    expect(result).toMatchObject({ phase: "waiting", problem: "start_failed", attempts: 1, detail: "podman start exited 125" });
    expect(result.nextRetryAt).toBe(scheduled()[0]);
    // A bot asking meanwhile does not jump the delay.
    await h.auto.ensure("bot");
    expect(start).toHaveBeenCalledTimes(1);

    for (let attempt = 1; attempt <= LOCAL_VM_AUTO_BACKOFF_MS.length; attempt += 1) {
      const timer = h.timers.shift()!;
      timer.run();
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(attempt + 1));
      await vi.waitFor(() => expect(["waiting", "problem"]).toContain(h.auto.snapshot().phase));
    }
    result = h.auto.snapshot();
    expect(result).toMatchObject({ phase: "problem", problem: "start_failed", attempts: 4, nextRetryAt: null });
    expect(h.timers).toHaveLength(0);
    // Given up: a bot does not restart the loop, the person does.
    await h.auto.ensure("bot");
    expect(start).toHaveBeenCalledTimes(4);
    await h.auto.ensure("person");
    expect(start).toHaveBeenCalledTimes(5);
  });

  it("waits 30 s, then 2 min, then 10 min between attempts", async () => {
    const delays: number[] = [];
    const h = harness(vm({ container: "stopped", ready: false, resumable: true }), {
      start: async () => { throw new Error("no"); },
    });
    const schedule = (run: () => void, ms: number) => { delays.push(ms); return h.timers.push({ run, at: 0 }) && h.timers[h.timers.length - 1]; };
    const auto = new LocalVmAutoStarter({
      mode: () => "shared", allowed: () => true, status: async () => h.get(), startRuntime: async () => true,
      prepareImage: async () => {}, create: async () => h.get(), start: async () => { throw new Error("no"); },
      remove: async () => h.get(), busy: () => false, wait: async () => {}, now: () => 0, schedule, cancel: () => {},
    });
    await auto.ensure("launch");
    for (let index = 0; index < 3; index += 1) {
      h.timers.shift()!.run();
      await vi.waitFor(() => expect(delays.length === index + 2 || auto.snapshot().phase === "problem").toBe(true));
    }
    expect(delays).toEqual([...LOCAL_VM_AUTO_BACKOFF_MS]);
    expect(LOCAL_VM_AUTO_BACKOFF_MS).toEqual([30_000, 120_000, 600_000]);
  });

  it("downloads the image at most once per launch", async () => {
    const prepareImage = vi.fn(async () => { throw new Error("network down"); });
    const h = harness(vm({ image: false, container: "missing", ready: false, managed: false }), { prepareImage });
    expect(await h.auto.ensure("launch")).toMatchObject({ phase: "problem", problem: "image_failed", nextRetryAt: null });
    expect(h.timers).toHaveLength(0);
    await h.auto.ensure("launch");
    await h.auto.ensure("bot");
    expect(prepareImage).toHaveBeenCalledTimes(1);
    // The person's Retry is a new allowance.
    await h.auto.ensure("person");
    expect(prepareImage).toHaveBeenCalledTimes(2);
  });

  it("asks nothing of a computer without a runtime, and never installs one", async () => {
    const h = harness(vm({ runtime: null, daemonUp: false, image: false, container: "missing", ready: false, managed: false }));
    expect(await h.auto.ensure("launch")).toMatchObject({ phase: "problem", problem: "no_runtime" });
    expect(h.calls).toEqual([]);
    expect(h.timers).toHaveLength(0);
  });

  it("per-bot mode prepares the runtime and image only; each bot starts its own", async () => {
    const h = harness(vm({ image: false, container: "missing", ready: false, managed: false }), { mode: () => "per-bot" });
    await h.auto.ensure("launch");
    expect(h.calls).toEqual(["pull"]);
    expect(h.auto.snapshot().phase).toBe("running");
  });

  it("runs once at a time and leaves a person's setup alone", async () => {
    const h = harness(vm({ container: "missing", ready: false, managed: false }));
    const [first, second] = await Promise.all([h.auto.ensure("launch"), h.auto.ensure("bot")]);
    expect(first).toEqual(second);
    expect(h.calls).toEqual(["create"]);

    const busy = harness(vm({ container: "missing", ready: false, managed: false }), { busy: () => true });
    await busy.auto.ensure("launch");
    expect(busy.calls).toEqual([]);
  });

  it("does nothing where the Local VM is not allowed", async () => {
    const h = harness(vm({ container: "missing", ready: false, managed: false }), { allowed: () => false });
    expect(await h.auto.ensure("launch")).toMatchObject({ phase: "idle" });
    expect(h.calls).toEqual([]);
  });
});
