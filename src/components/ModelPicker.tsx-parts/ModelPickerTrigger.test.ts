import { describe, expect, it } from "vitest";

import type { InstanceInfo } from "@/state/store";
import { listChipLabel, listChipPayer } from "./ModelPickerTrigger";

const claude = {
  instanceId: "claude-work",
  displayName: "alex_bots@example.test",
  driverKind: "claudeAgent",
  snapshot: { state: "available", authenticated: true },
  models: { default: "opus", options: [{ id: "opus", label: "Claude Opus 4.1" }] },
} as unknown as InstanceInfo;

describe("list chip", () => {
  it("starts with the model, never the account or the provider name", () => {
    const label = listChipLabel({ autoOn: false, autoRecord: null, active: claude, selection: { instanceId: "claude-work", model: "opus", effort: "medium" } as never, showActiveAccount: true });
    expect(label.startsWith("Claude Opus 4.1")).toBe(true);
    expect(label).not.toContain("alex_bots");
    expect(label).not.toContain(" · Claude");
  });

  it("names the paying account only when the provider has several", () => {
    expect(listChipPayer({ autoOn: false, active: claude, showActiveAccount: true })).toBe("alex_bots@example.test");
    expect(listChipPayer({ autoOn: false, active: claude, showActiveAccount: false })).toBeUndefined();
    expect(listChipPayer({ autoOn: true, active: claude, showActiveAccount: true })).toBeUndefined();
  });
});
