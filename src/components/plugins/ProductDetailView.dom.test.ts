// @vitest-environment happy-dom
// #4185: the person's Perspicax products in Connect Apps and the product key
// card: one row per product with its state in words, the page draws exactly
// the actions Perspicax lists (any other is hidden, never disabled), the key
// form is built from the product's own fields, and the card folds into one
// line once the key is saved and tested.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersonProduct } from "@/lib/person-products";
import type { Message } from "@/state/store";

const api = vi.fn();
let storeState: Record<string, unknown> = {};
vi.mock("@/state/store", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/state/store/api");
  return { api: (...args: unknown[]) => api(...args), ApiError: actual.ApiError, useStore: () => ({ state: storeState, dispatch: vi.fn() }) };
});

const { productRows } = await import("./ProductRows");
const { ProductDetailView } = await import("./ProductDetailView");
const { ProductKeyCard } = await import("../ProductKeyCard");

const base: PersonProduct = {
  id: "psa-1f0c", name: "Acme PSA", state: "connected", roles: [{ slug: "tech", name: "Technicians", mode: "hybrid" }],
  address: "https://psa.acme.example", actions: [],
};
const form = { kind: "basic", fields: [
  { slot: "username", label: { en: "Username" }, secret: false, required: true },
  { slot: "password", label: { en: "Password" }, secret: true, required: true },
] };

let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  api.mockReset();
  storeState = {};
});

describe("product rows", () => {
  it("keep the name readable at phone width: the state wraps beside it, never shrink-0", async () => {
    const rows = productRows([{ ...base, name: "Endpoint Security", state: "key_refused" }], () => {});
    const view = await render(createElement("div", null, rows.map((row) => createElement("div", { key: row.key }, row.node))));
    const state = view.querySelector("[data-person-product] [data-plugin-status]")!;
    // the state never holds its width against the name: it may go to its own line under it
    expect(state.className).not.toMatch(/\bshrink-0\b/);
    expect(state.parentElement?.matches("[data-person-product-line]")).toBe(true);
    expect(state.parentElement?.className).toMatch(/\bflex-wrap\b/);
  });

  it("say each state in words, at the row's right, once", async () => {
    const states: PersonProduct["state"][] = ["connected", "key_missing", "key_refused", "not_served"];
    const rows = productRows(states.map((state, index) => ({ ...base, id: `p${index}`, name: `Product ${index}`, state })), () => {});
    const view = await render(createElement("div", null, rows.map((row) => createElement("div", { key: row.key }, row.node))));
    const words = [...view.querySelectorAll("[data-person-product]")].map((row) => row.querySelector("[data-plugin-status]")?.textContent?.trim());
    expect(words).toEqual(["Connected", "Key missing", "Key refused by the vendor", "Not served on this deployment"]);
    // the grey line is the roles, never the state again, and no id shows
    expect(view.textContent).toContain("Technicians");
    expect(view.textContent?.match(/Key missing/g)).toHaveLength(1);
    expect(view.textContent).not.toContain("p1");
  });

  it("line up with the Installed rows: the neighbours' state text and their trailing \"...\"", async () => {
    const states: PersonProduct["state"][] = ["connected", "key_missing", "key_refused", "not_served"];
    const rows = productRows(states.map((state, index) => ({ ...base, id: `p${index}`, name: `Product ${index}`, state, consoleUrl: "https://console.example/p" })), () => {});
    const view = await render(createElement("div", null, rows.map((row) => createElement("div", { key: row.key }, row.node))));
    for (const row of view.querySelectorAll("[data-person-product]")) {
      // the same trailing slot as every neighbour row, so the states sit in one column
      expect(row.lastElementChild?.querySelector("[data-entry-menu]")).not.toBeNull();
      const state = row.querySelector<HTMLElement>("[data-product-state]");
      if (state) {
        expect(state.className).toContain("text-[13px]");
        expect(state.className).toContain("font-normal");
        expect(state.className).not.toContain("font-medium");
      }
    }
    const refused = view.querySelector<HTMLElement>("[data-person-product='p2'] [data-product-state]")!;
    expect(refused.className).toContain("text-warning");
  });

  it("offer the page's own \"...\" actions in the row: open in Perspicax, copy the id", async () => {
    const view = await render(createElement("div", null, productRows([{ ...base, consoleUrl: "https://console.example/p" }], () => {})[0]!.node));
    await act(async () => { view.querySelector<HTMLButtonElement>("[data-entry-menu]")!.click(); });
    const ids = [...view.querySelectorAll("[data-entry-action]")].map((item) => item.getAttribute("data-entry-action"));
    expect(ids).toEqual(["open-console", "copy-id"]);
  });

  it("hide Open in Perspicax when Perspicax names no console page", async () => {
    const view = await render(createElement("div", null, productRows([base], () => {})[0]!.node));
    await act(async () => { view.querySelector<HTMLButtonElement>("[data-entry-menu]")!.click(); });
    const ids = [...view.querySelectorAll("[data-entry-action]")].map((item) => item.getAttribute("data-entry-action"));
    expect(ids).toEqual(["copy-id"]);
  });

  it("open the product's page", async () => {
    const opened = vi.fn();
    const view = await render(createElement("div", null, productRows([base], opened)[0]!.node));
    await act(async () => { view.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(opened).toHaveBeenCalledWith(base);
  });
});

describe("product page", () => {
  it("words each serving mode Perspicax names and hides one it does not, never a raw slug", async () => {
    const modes = ["model", "per_operation", "compact", "minimal", "group", "hybrid", "dispatch"];
    const roles = modes.map((mode, index) => ({ slug: `r-${mode}`, name: `Role ${index}`, mode }));
    const view = await render(createElement(ProductDetailView, { product: { ...base, roles }, onChanged: () => {}, onBack: () => {} }));
    const words = [...view.querySelectorAll("[data-person-product-roles] li")].map((item) => item.querySelector("[data-person-product-mode]")?.textContent ?? null);
    expect(words).toEqual([
      "One tool per resource", "One tool per operation", "Compact tools", "Search only", "Grouped tools", "Grouped tools and recipes", null,
    ]);
    expect(view.textContent).not.toMatch(/per_operation|dispatch|Asks before writing/);
  });

  it("hides every action Perspicax did not list", async () => {
    const view = await render(createElement(ProductDetailView, { product: { ...base, key: { source: "role", kind: "api_key" } }, onChanged: () => {}, onBack: () => {} }));
    expect(view.querySelector("[data-person-product-actions]")).toBeNull();
    expect(view.textContent).toContain("A key of the role Technicians");
    expect(view.textContent).toContain("API key");
    expect(view.textContent).not.toContain("psa-1f0c");
  });

  it("names the role of a role key only when the person holds exactly one role", async () => {
    const roles = [{ slug: "tech", name: "Technicians", mode: "hybrid" }, { slug: "lead", name: "Leads", mode: "hybrid" }];
    const view = await render(createElement(ProductDetailView, { product: { ...base, roles, key: { source: "role", kind: "api_key" } }, onChanged: () => {}, onBack: () => {} }));
    expect(view.textContent).toContain("A key of one of your roles");
    expect(view.textContent).not.toContain("A key of the role");
  });

  it("shows the person's own key, its ending and last test, with the listed actions only", async () => {
    const product: PersonProduct = {
      ...base, form, actions: ["set_own_key", "test"],
      key: { source: "own", kind: "basic", ending: "1a2b", lastTest: { at: new Date().toISOString(), ok: true } },
    };
    const view = await render(createElement(ProductDetailView, { product, onChanged: () => {}, onBack: () => {} }));
    expect(view.textContent).toContain("Your key");
    expect(view.textContent).toContain("•••• 1a2b");
    expect(view.querySelector("[data-person-product-test='ok']")).not.toBeNull();
    const actions = [...view.querySelectorAll("[data-person-product-action]")].map((button) => button.getAttribute("data-person-product-action"));
    expect(actions).toEqual(["replace_own", "test"]);
  });

  it("builds the key form from the product's fields, masks a secret one and sends every value at once, a secret exactly as typed", async () => {
    const changed = vi.fn();
    const product: PersonProduct = { ...base, state: "key_missing", form, actions: ["set_own_key"] };
    api.mockResolvedValue({ product: { ...product, state: "connected", key: { source: "own", lastTest: { at: new Date().toISOString(), ok: true } } } });
    const view = await render(createElement(ProductDetailView, { product, onChanged: changed, onBack: () => {} }));
    await act(async () => { view.querySelector<HTMLButtonElement>("[data-person-product-action='add_own']")!.click(); });
    const inputs = [...view.querySelectorAll<HTMLInputElement>("[data-product-key-field] input")];
    expect(inputs.map((input) => input.type)).toEqual(["text", "password"]);
    expect(inputs[1]!.autocomplete).toBe("new-password");
    const save = view.querySelector<HTMLButtonElement>("[data-product-key-save]")!;
    expect(save.disabled).toBe(true);
    const type = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { type(inputs[0]!, " ada "); type(inputs[1]!, " pw "); });
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    expect(api).toHaveBeenCalledWith("/api/me/perspicax/products/psa-1f0c/key", { method: "PUT", body: JSON.stringify({ values: { username: "ada", password: " pw " } }) });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ state: "connected" }));
  });
});

describe("product key card", () => {
  const message = (secret: Record<string, unknown>): Message => ({
    id: "m-1", role: "bot", kind: "productKey", text: "", at: 0,
    secret: { target: "perspicaxProduct", label: "Acme PSA", description: "", placeholder: "", helpUrl: "", requestKey: "r", product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_missing" }, ...secret },
  }) as Message;

  it("reads the product's form when it draws and offers it", async () => {
    api.mockResolvedValue({ product: { ...base, state: "key_missing", form, actions: ["set_own_key"] } });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({}) }));
    await act(async () => {});
    expect(api).toHaveBeenCalledWith("/api/me/perspicax/products/psa-1f0c");
    expect(view.querySelectorAll("[data-product-key-field]")).toHaveLength(2);
  });

  it("folds into one line once saved and tested", async () => {
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({ provided: true, resumed: true, result: { ok: true, at: 1 } }) }));
    expect(view.querySelector("[data-product-key-card-settled]")?.textContent).toBe("Acme PSA key saved, tested");
    expect(view.querySelector("form")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("says a refused key once, on a card raised for a refused key", async () => {
    api.mockResolvedValue({ product: { ...base, state: "key_refused", form, actions: ["set_own_key"] } });
    const refusedCard = message({ product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_refused" }, result: { ok: false, status: 401, code: "unauthorized", at: 1 } });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: refusedCard }));
    await act(async () => {});
    expect(view.textContent?.match(/refused/g)).toHaveLength(1);
    expect(view.querySelector("[data-product-key-card-refused]")?.textContent).toContain("401, unauthorized");
  });

  it("shows any viewer other than the card's person the folded line, without reading the product", async () => {
    storeState = { config: { viewer: { principalId: "pr_bob", role: "member" } } };
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({ product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_missing", for: "pr_ann" } }) }));
    await act(async () => {});
    expect(view.querySelector("form")).toBeNull();
    expect(view.querySelector("[data-product-key-field]")).toBeNull();
    expect(view.textContent).toContain("waiting for its owner's key");
    expect(api).not.toHaveBeenCalled();
  });

  it("draws the form for the card's own person", async () => {
    storeState = { config: { viewer: { principalId: "PR_ANN", role: "member" } } };
    api.mockResolvedValue({ product: { ...base, state: "key_missing", form, actions: ["set_own_key"] } });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({ product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_missing", for: "pr_ann" } }) }));
    await act(async () => {});
    expect(view.querySelectorAll("[data-product-key-field]")).toHaveLength(2);
  });

  it("draws no field for a product the person may not type a key for", async () => {
    api.mockResolvedValue({ product: { ...base, state: "setup_incomplete", actions: [], consoleUrl: "https://console.example/p" } });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({}) }));
    await act(async () => {});
    expect(view.querySelector("[data-product-key-field]")).toBeNull();
    expect(view.textContent).toContain("Setup to finish by an administrator");
    expect(view.textContent).toContain("Open in Perspicax");
  });
});
