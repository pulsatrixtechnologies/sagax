// Organization server admission, per engine: the turn runs with its tools
// withheld, or 409 host_tools with the engine's own reason (the words the
// picker and the engine card show, shared/org-engines.ts).
import { describe, expect, it } from "vitest";

import { orgHostToolsReason, orgHostToolsRefusal } from "../../shared/org-engines.ts";
import { BUILT_IN_DRIVERS } from "../drivers/builtIn.ts";
import { OrgHostToolsError, orgWithholdHostTools } from "./org-engine-admission.ts";

const admitted = { adapter: { capabilities: { withholdsHostTools: true } }, driverKind: "geminiAgent" };
const refused = (driverKind: string) => ({ adapter: { capabilities: {} }, driverKind });

describe("organization server engine admission", () => {
  it("withholds nothing off an organization server, whatever the engine", () => {
    expect(orgWithholdHostTools(refused("droidAgent"), false, "Droid")).toBe(false);
    expect(orgWithholdHostTools(admitted, false, "Gemini")).toBe(false);
  });

  it("runs an engine that withholds its tools, with them withheld", () => {
    expect(orgWithholdHostTools(admitted, true, "Gemini")).toBe(true);
  });

  it.each([
    ["droidAgent", "Droid", "Droid cannot hold back its own tools on this server. Its ACP mode ignores the tool selection, so its shell and file tools would run there."],
    ["cursorAgent", "Cursor", "Cursor cannot hold back its own tools on this server. Its service chooses the tools it offers, and no setting removes its shell and file tools."],
    ["antigravityAgent", "Antigravity", "Antigravity cannot hold back its own tools on this server. No setting that removes its shell and file tools has been verified."],
  ])("refuses %s with 409 host_tools and its reason", (driverKind, name, message) => {
    let error: unknown;
    try { orgWithholdHostTools(refused(driverKind), true, name); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(OrgHostToolsError);
    expect(error).toMatchObject({ status: 409, code: "host_tools", message });
    expect(orgHostToolsRefusal(name, driverKind)).toBe(message);
  });

  // The matrix of docs/code/organization.md "Engines on an organization server", read from
  // the drivers themselves: a driver's flag is what the server checks.
  it("admits exactly the engines verified with their real CLI", async () => {
    const expected: Record<string, boolean> = {
      grokAgent: true, geminiAgent: true, qwenAgent: true, kimiAgent: true, opencodeGo: true, hermesAgent: true,
      droidAgent: false, cursorAgent: false,
    };
    for (const [driverKind, ok] of Object.entries(expected)) {
      const driver = BUILT_IN_DRIVERS.find((candidate) => candidate.driverKind === driverKind);
      expect(driver, driverKind).toBeDefined();
      // a CLI path that does not exist: nothing real is started or asked
      const instance = await driver!.create({ instanceId: `admission-${driverKind}`, displayName: driverKind, enabled: true, config: { cli: "/nonexistent/sagax-admission-fixture" } as never, environment: { SAGAX_PROBE_LOCAL_INJECT: "0" } });
      try {
        expect(instance.adapter.capabilities.withholdsHostTools === true, driverKind).toBe(ok);
        if (!ok) expect(orgHostToolsReason(driverKind)).not.toBe("unverified");
      } finally {
        await instance.dispose();
      }
    }
  });
});
