// @vitest-environment happy-dom
// Visible roles, batch 3 (2026-11-05): the composer's role picker. Rows,
// "Moi" first, the "peut : …" line, the explicit-only row greyed but
// pickable, no id on screen, and the pick sent with the next message only.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { rolePick, takeRolePick } from "@/lib/role-pick";
import type { HeldRolesAnswer } from "./RolePicker";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async () => null,
}));

const { RolePicker, roleCanLine } = await import("./RolePicker");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; takeRolePick("nova", "t1"); });
beforeAll(() => setLocale("fr"));

const HELD: HeldRolesAnswer = {
  available: true,
  current: "",
  roles: [
    { slug: "service-desk", name: "Service Desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true, routines_run: true } },
    { slug: "full-access", name: "Full Access", readOnly: false, explicitOnly: true, reachable: true, can: { read: true, write: true, approvals_answer: true, flow: true, sagax: true } },
  ],
};

async function mount(answer: HeldRolesAnswer, initialOpen = true) {
  const load = vi.fn(async () => answer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(RolePicker, { botId: "nova", threadId: "t1", initialOpen, organization: true, load })); });
  return { view: host, load };
}

describe("composer role picker", () => {
  it("lists Moi first, then each held role with what it can do; an explicit-only role is greyed", async () => {
    const { view, load } = await mount(HELD);
    expect(load).toHaveBeenCalledWith("nova", "t1");
    const rows = [...view.querySelectorAll<HTMLElement>("[data-role-picker-row]")];
    expect(rows.map((row) => row.dataset.rolePickerRow)).toEqual(["me", "service-desk", "full-access"]);
    expect(rows[0]!.textContent).toContain("Moi");
    expect(rows[0]!.getAttribute("aria-checked")).toBe("true");
    expect(rows[1]!.querySelector("[data-role-picker-can]")!.textContent).toBe("peut : lire, écrire, lancer des routines");
    expect(rows[2]!.dataset.roleExplicitOnly).toBe("true");
    expect(rows[2]!.textContent).toContain("sur demande seulement");
    expect(rows[2]!.querySelector("[data-role-picker-can]")!.textContent).toBe("peut : lire, écrire, répondre aux approbations, utiliser Flow, utiliser Sagax");
    // the slug rides the tooltip only
    expect(rows[1]!.title).toContain("service-desk");
    expect(rows[1]!.textContent).not.toContain("service-desk");
  });

  it("keeps the pick for the next message of this thread, shown on the chip until it is sent", async () => {
    const { view } = await mount(HELD);
    await act(async () => { view.querySelector<HTMLElement>('[data-role-picker-row="full-access"]')!.click(); });
    expect(rolePick("nova", "t1")).toBe("full-access");
    expect(view.querySelector("[data-role-picker-trigger]")!.textContent).toContain("Full Access");
    expect(view.querySelector<HTMLElement>("[data-role-picker]")!.dataset.rolePicked).toBe("full-access");
    // the send takes it once
    expect(takeRolePick("nova", "t1")).toBe("full-access");
    expect(takeRolePick("nova", "t1")).toBeUndefined();
    await act(async () => {});
    expect(view.querySelector("[data-role-picker-trigger]")!.textContent).toContain("Moi");
  });

  it("shows nothing where Perspicax is not mounted", async () => {
    const { view } = await mount({ available: false, roles: [] });
    expect(view.querySelector("[data-role-picker]")).toBeNull();
  });

  it("words abilities, read only when nothing is known", () => {
    expect(roleCanLine(undefined)).toBe("peut : lire");
  });
});
