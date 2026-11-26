import { describe, expect, it, vi } from "vitest";
import { installMenuBarUsage, menuBarUsage, menuBarUsageDetail } from "./menu-bar-usage";
import { connectedPlanRows, type PlanProvider, type PlanUsageReport } from "./plan-usage";

function account(id: string, week: number | null, session: number | null, hours?: number): PlanProvider {
  const window = (used: number | null, extra: object = {}) => used === null
    ? { available: false, remainingPercent: null, usedPercent: null, resetsAt: null }
    : { available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: null, ...extra };
  return { id, name: `${id}@acme.example`, driver: "claude", ok: true, error: null, state: "windows", access: "subscription", weekly: window(week), fiveHour: window(session, hours ? { hours } : {}) };
}

const report = (...providers: PlanProvider[]): PlanUsageReport => ({ providers });

describe("the menu bar's usage figures", () => {
  it("reads each window's highest account and writes the account menu's figure", () => {
    const usage = menuBarUsage(connectedPlanRows(report(account("ada", 44.2, 12), account("nimbus", 30, 20.4))));
    expect(usage).toEqual({ week: 44, session: 20, text: "44%" });
    expect(menuBarUsageDetail(usage)).toBe("week 44%, 5 h 20%");
  });

  it("has no figure when no account reports a window", () => {
    const usage = menuBarUsage(connectedPlanRows(report({ id: "key", name: "Claude (API key)", ok: true, error: null, state: "no-windows", access: "api-key" })));
    expect(usage).toEqual({ week: null, session: null, text: "" });
    expect(menuBarUsageDetail(usage)).toBe("");
  });

  it("names only the window that is reported", () => {
    const usage = menuBarUsage(connectedPlanRows(report(account("ada", null, 61))));
    expect(usage).toEqual({ week: null, session: 61, text: "61%" });
    expect(menuBarUsageDetail(usage, 3)).toBe("3 h 61%");
  });
});

describe("the page answers the shell", () => {
  function bridge() {
    let refresh: (() => void) | null = null;
    const update = vi.fn();
    const stop = vi.fn();
    return { update, stop, ask: () => refresh?.(), onRefresh: (cb: () => void) => { refresh = cb; return stop; } };
  }

  it("hands the figures over when it loads and each time the shell asks", async () => {
    const shell = bridge();
    const read = vi.fn(async () => report(account("ada", 44, 20, 3)));
    const stop = installMenuBarUsage({ bridge: shell, read, enabled: () => true });
    await vi.waitFor(() => expect(shell.update).toHaveBeenCalledTimes(1));
    expect(shell.update).toHaveBeenLastCalledWith({ week: 44, session: 20, text: "44%", tooltip: "week 44%, 3 h 20%" });
    shell.ask();
    await vi.waitFor(() => expect(shell.update).toHaveBeenCalledTimes(2));
    stop();
    expect(shell.stop).toHaveBeenCalled();
  });

  it("reads nothing while the switch is off", async () => {
    const shell = bridge();
    const read = vi.fn(async () => report(account("ada", 44, 20)));
    installMenuBarUsage({ bridge: shell, read, enabled: () => false });
    shell.ask();
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(shell.update).not.toHaveBeenCalled();
  });

  it("keeps quiet when the figures cannot be read", async () => {
    const shell = bridge();
    const read = vi.fn(async () => { throw new Error("signed out"); });
    installMenuBarUsage({ bridge: shell, read, enabled: () => true });
    shell.ask();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(shell.update).not.toHaveBeenCalled();
  });

  it("does nothing in the browser, where there is no shell", () => {
    expect(installMenuBarUsage({ read: async () => report() })()).toBeUndefined();
  });
});
