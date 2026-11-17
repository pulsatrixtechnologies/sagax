// @vitest-environment happy-dom
// The person's products are one store for the app (#4507): the Connect apps
// page and the chips of record links read the same list, so a product
// connected on one shows on the other at once.
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nimbusProduct, nimbusProductRaw } from "./record-card-fixtures";
import { resetPersonProducts, seedPersonProducts, usePersonProducts, useSharedPersonProducts } from "./person-products";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reads: number;
beforeEach(() => {
  resetPersonProducts();
  reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    reads += 1;
    return new Response(JSON.stringify({ products: [nimbusProductRaw()] }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const seen: { page: ReturnType<typeof usePersonProducts> | null; chips: string[] } = { page: null, chips: [] };
  const Page = () => { seen.page = usePersonProducts(true); return null; };
  const Chips = () => { seen.chips = useSharedPersonProducts().map((product) => product.name); return null; };
  act(() => root.render(createElement("div", null, createElement(Page), createElement(Chips))));
  return { seen, stop: () => { act(() => root.unmount()); host.remove(); } };
}

describe("one list of the person's products", () => {
  it("is read once for the page and the chips together", async () => {
    const view = mount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(view.seen.chips).toEqual(["Nimbus Desk"]);
    expect(view.seen.page!.products.map((product) => product.name)).toEqual(["Nimbus Desk"]);
    expect(reads).toBe(1);
    view.stop();
  });

  it("shows on the chips at once what the page replaces", async () => {
    const view = mount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const renamed = { ...nimbusProduct(), name: "Nimbus Desk Plus" };
    await act(async () => { view.seen.page!.replace(renamed); });
    expect(view.seen.chips).toEqual(["Nimbus Desk Plus"]);
    await act(async () => { seedPersonProducts([]); });
    expect(view.seen.page!.products).toEqual([]);
    view.stop();
  });
});
