import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storedPersonLabel, resetPersonLabelsForTests } from "@/lib/person-labels";

// The edit flows: the inline field's save goes to PUT /api/people/<id>/label
// and the answer shows at once. The field itself is captured (its own
// clicks are covered by bot-settings/InlineEditableText.test.ts).
const fixture = vi.hoisted(() => ({
  fields: [] as Array<{ ariaLabel: string; placeholder?: string; maxLength?: number; onSave?: (next: string) => void }>,
  dispatch: vi.fn(),
  role: "admin" as "admin" | "member",
}));
vi.mock("./bot-settings/InlineEditableText", () => ({
  InlineEditableText: (props: (typeof fixture.fields)[number]) => {
    fixture.fields.push(props);
    return null;
  },
}));
vi.mock("./DesktopCapabilities", () => ({ useCaptionChrome: () => ({ padClass: "" }), useMacInsetChrome: () => ({ macInset: false, browser: false }) }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => ({ org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: fixture.role, settings: {} }),
}));
vi.mock("./GroupPeoplePicker", () => ({ useOrgDirectory: () => null }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: { viewer: { principalId: "pr_me" } } }, dispatch: fixture.dispatch }) };
});

const { PersonPanel } = await import("./PersonPanel");
const { MyLabelField } = await import("./settings/MyLabelField");

const directory = { people: [{ principalId: "pr_ada", name: "Ada", login: "ada", role: "member" as const, disabled: false, teams: [] }], teams: [] };
const labelField = () => fixture.fields.find((field) => field.ariaLabel === "Edit label");

describe("editing a person's label", () => {
  let calls: Array<{ path: string; method?: string; body: unknown }>;
  beforeEach(() => {
    fixture.fields = [];
    fixture.dispatch.mockReset();
    fixture.role = "admin";
    resetPersonLabelsForTests();
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method: init?.method, body });
      const id = path.split("/")[3]!;
      return new Response(JSON.stringify({ principalId: id, label: body?.label ?? null }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPersonLabelsForTests();
  });

  it("an admin labels a colleague from their sheet", async () => {
    renderToStaticMarkup(createElement(PersonPanel, { personId: "pr_ada", directory }));
    const field = labelField();
    expect(field).toMatchObject({ placeholder: "Add a label", maxLength: 40 });
    field!.onSave!("Dispatch");
    await vi.waitFor(() => expect(storedPersonLabel("pr_ada")).toBe("Dispatch"));
    expect(calls).toEqual([{ path: "/api/people/pr_ada/label", method: "PUT", body: { label: "Dispatch" } }]);
  });

  it("a member's sheet of a colleague has no save", () => {
    fixture.role = "member";
    renderToStaticMarkup(createElement(PersonPanel, { personId: "pr_ada", directory }));
    expect(labelField()?.onSave).toBeUndefined();
  });

  it("a person sets their own in Settings, and a refusal says so", async () => {
    renderToStaticMarkup(createElement(MyLabelField));
    const field = labelField();
    expect(field).toMatchObject({ placeholder: "Add a label", maxLength: 40 });
    field!.onSave!("CTO");
    await vi.waitFor(() => expect(storedPersonLabel("pr_me")).toBe("CTO"));
    expect(calls[0]).toEqual({ path: "/api/people/pr_me/label", method: "PUT", body: { label: "CTO" } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 403 })));
    field!.onSave!("CFO");
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "error", message: "The label could not be saved." }));
    expect(storedPersonLabel("pr_me")).toBe("CTO");
  });
});
