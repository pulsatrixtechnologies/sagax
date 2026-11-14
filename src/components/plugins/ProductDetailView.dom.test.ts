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
import { parsePersonProduct } from "../../../shared/person-products";
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

// Every product here is what Perspicax serves (crates/gateway/openapi.json
// PersonProduct), read by the one parser the server uses before the app sees it.
const NO_ACTIONS = { set_own_key: false, replace_key: false, test: false, remove_own_key: false, sign_in: false, sign_out: false };
const form = { kind: "basic", fields: [
  { slot: "username", label: { en: "Username", fr: "Nom d'utilisateur" }, secret: false, required: true },
  { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true },
] };
function px(over: Record<string, unknown> = {}): PersonProduct {
  return parsePersonProduct({
    id: "psa-1f0c", name: "Acme PSA", auth_state: "ok", setup: { missing: [], per_customer_address: false }, state: "connected",
    base_url: "https://psa.acme.example", reason_code: null, takes_key_kind: "basic",
    key: { source: "default", named: false, own: false },
    profiles: [{ name: "Technicians", mode: "hybrid", personal: false }],
    form: null, actions: NO_ACTIONS, console_url: "",
    ...over,
  })!;
}
const base = px();

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
    const rows = productRows([px({ name: "Endpoint Security", state: "key_refused" })], () => {});
    const view = await render(createElement("div", null, rows.map((row) => createElement("div", { key: row.key }, row.node))));
    const state = view.querySelector("[data-person-product] [data-plugin-status]")!;
    // the state never holds its width against the name: it may go to its own line under it
    expect(state.className).not.toMatch(/\bshrink-0\b/);
    expect(state.parentElement?.matches("[data-person-product-line]")).toBe(true);
    expect(state.parentElement?.className).toMatch(/\bflex-wrap\b/);
  });

  it("say each state in words, at the row's right, once", async () => {
    const states: PersonProduct["state"][] = ["connected", "key_missing", "key_refused", "not_served"];
    const rows = productRows(states.map((state, index) => px({ id: `p${index}`, name: `Product ${index}`, state })), () => {});
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
    const rows = productRows(states.map((state, index) => px({ id: `p${index}`, name: `Product ${index}`, state, console_url: "https://console.example/p" })), () => {});
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
    const view = await render(createElement("div", null, productRows([px({ console_url: "https://console.example/p" })], () => {})[0]!.node));
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
    const profiles = modes.map((mode, index) => ({ name: `Role ${index}`, mode, personal: false }));
    const view = await render(createElement(ProductDetailView, { product: px({ profiles }), onChanged: () => {}, onBack: () => {} }));
    const words = [...view.querySelectorAll("[data-person-product-roles] li")].map((item) => item.querySelector("[data-person-product-mode]")?.textContent ?? null);
    expect(words).toEqual([
      "One tool per resource", "One tool per operation", "Compact tools", "Search only", "Grouped tools", "Grouped tools and recipes", null,
    ]);
    expect(view.textContent).not.toMatch(/per_operation|dispatch|Asks before writing/);
  });

  it("shows the address and the access Perspicax serves, a direct link in words and never its hidden role's name", async () => {
    const profiles = [{ name: "Technicians", mode: "hybrid", personal: false }, { name: "user-7f3a", mode: "compact", personal: true }];
    const view = await render(createElement(ProductDetailView, { product: px({ profiles }), onChanged: () => {}, onBack: () => {} }));
    expect(view.querySelector("[data-person-product-address]")?.textContent).toBe("https://psa.acme.example");
    const access = [...view.querySelectorAll("[data-person-product-roles] li")].map((item) => item.textContent);
    expect(access).toEqual(["TechniciansGrouped tools and recipes", "Given to you directlyCompact tools"]);
    expect(view.textContent).not.toContain("user-7f3a");
    const row = await render(createElement("div", null, productRows([px({ profiles })], () => {})[0]!.node));
    expect(row.textContent).toContain("Technicians");
    expect(row.textContent).not.toContain("user-7f3a");
  });

  it("words each key source Perspicax names: yours, a role's, the organization's", async () => {
    const source = async (key: Record<string, unknown>) => {
      const view = await render(createElement(ProductDetailView, { product: px({ key }), onChanged: () => {}, onBack: () => {} }));
      return view.querySelector("[data-person-product-key] dd")?.textContent;
    };
    expect(await source({ source: "user", named: true, own: true })).toBe("Your key");
    expect(await source({ source: "profile", named: false, own: false })).toBe("A key of the role Technicians");
    expect(await source({ source: "default", named: false, own: false })).toBe("The organization's shared key");
  });

  it("hides every action Perspicax did not list", async () => {
    const view = await render(createElement(ProductDetailView, { product: px({ takes_key_kind: "api_key", key: { source: "profile", named: false, own: false } }), onChanged: () => {}, onBack: () => {} }));
    expect(view.querySelector("[data-person-product-actions]")).toBeNull();
    expect(view.textContent).toContain("A key of the role Technicians");
    expect(view.textContent).toContain("API key");
    expect(view.textContent).not.toContain("psa-1f0c");
  });

  it("names the role of a role key only when the person holds exactly one role", async () => {
    const profiles = [{ name: "Technicians", mode: "hybrid", personal: false }, { name: "Leads", mode: "hybrid", personal: false }];
    const view = await render(createElement(ProductDetailView, { product: px({ profiles, key: { source: "profile", named: false, own: false } }), onChanged: () => {}, onBack: () => {} }));
    expect(view.textContent).toContain("A key of one of your roles");
    expect(view.textContent).not.toContain("A key of the role");
  });

  it("shows the person's own key, its ending and last test, with the listed actions only", async () => {
    const product = px({
      form, actions: { ...NO_ACTIONS, set_own_key: true, test: true, remove_own_key: true },
      key: { source: "user", named: true, own: true, name: "mine", auth_type: "basic", last4: "1a2b", last4_slot: "username", last_test: { at: new Date().toISOString(), ok: true, code: "ok" } },
    });
    const view = await render(createElement(ProductDetailView, { product, onChanged: () => {}, onBack: () => {} }));
    expect(view.textContent).toContain("Your key");
    expect(view.textContent).toContain("Username and password");
    expect(view.textContent).toContain("•••• 1a2b");
    expect(view.querySelector("[data-person-product-test='ok']")).not.toBeNull();
    const actions = [...view.querySelectorAll("[data-person-product-action]")].map((button) => button.getAttribute("data-person-product-action"));
    expect(actions).toEqual(["replace_own", "test", "remove"]);
  });

  it("offers both writes Perspicax allows: the person's own key and the key that serves them", async () => {
    const product = px({ state: "key_refused", form, actions: { ...NO_ACTIONS, set_own_key: true, replace_key: true, test: true }, key: { source: "profile", named: true, own: false, auth_type: "basic", last4: "zz99", last4_slot: "username" } });
    api.mockResolvedValue({ product });
    const view = await render(createElement(ProductDetailView, { product, onChanged: () => {}, onBack: () => {} }));
    const actions = [...view.querySelectorAll("[data-person-product-action]")].map((button) => button.getAttribute("data-person-product-action"));
    expect(actions).toEqual(["add_own", "replace_shared", "test"]);
    await act(async () => { view.querySelector<HTMLButtonElement>("[data-person-product-action='replace_shared']")!.click(); });
    const inputs = [...view.querySelectorAll<HTMLInputElement>("[data-product-key-field] input")];
    const type = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { type(inputs[0]!, "ada"); type(inputs[1]!, "pw"); });
    await act(async () => { view.querySelector<HTMLButtonElement>("[data-product-key-save]")!.click(); });
    expect(api).toHaveBeenCalledWith("/api/me/perspicax/products/psa-1f0c/key", { method: "PUT", body: JSON.stringify({ target: "serving", values: { username: "ada", password: "pw" } }) });
  });

  it("builds the key form from the product's fields, masks a secret one and sends every value at once, a secret exactly as typed", async () => {
    const changed = vi.fn();
    const product = px({ state: "key_missing", form, actions: { ...NO_ACTIONS, set_own_key: true }, key: { source: null, named: false, own: false } });
    api.mockResolvedValue({ product: px({ state: "connected", key: { source: "user", named: true, own: true, last_test: { at: new Date().toISOString(), ok: true, code: "ok" } } }) });
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
    expect(api).toHaveBeenCalledWith("/api/me/perspicax/products/psa-1f0c/key", { method: "PUT", body: JSON.stringify({ target: "own", values: { username: "ada", password: " pw " } }) });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ state: "connected" }));
  });
});

describe("product key card", () => {
  const message = (secret: Record<string, unknown>): Message => ({
    id: "m-1", role: "bot", kind: "productKey", text: "", at: 0,
    secret: { target: "perspicaxProduct", label: "Acme PSA", description: "", placeholder: "", helpUrl: "", requestKey: "r", product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_missing" }, ...secret },
  }) as Message;

  it("reads the product's form when it draws and offers it", async () => {
    api.mockResolvedValue({ product: px({ state: "key_missing", form, actions: { ...NO_ACTIONS, set_own_key: true } }) });
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
    api.mockResolvedValue({ product: px({ state: "key_refused", form, actions: { ...NO_ACTIONS, set_own_key: true } }) });
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
    api.mockResolvedValue({ product: px({ state: "key_missing", form, actions: { ...NO_ACTIONS, set_own_key: true } }) });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({ product: { id: "psa-1f0c", name: "Acme PSA", reason: "key_missing", for: "pr_ann" } }) }));
    await act(async () => {});
    expect(view.querySelectorAll("[data-product-key-field]")).toHaveLength(2);
  });

  it("draws no field for a product the person may not type a key for", async () => {
    api.mockResolvedValue({ product: px({ state: "setup_incomplete", console_url: "https://console.example/p" }) });
    const view = await render(createElement(ProductKeyCard, { botId: "b", threadId: "t", message: message({}) }));
    await act(async () => {});
    expect(view.querySelector("[data-product-key-field]")).toBeNull();
    expect(view.textContent).toContain("Setup to finish by an administrator");
    expect(view.textContent).toContain("Open in Perspicax");
  });
});
