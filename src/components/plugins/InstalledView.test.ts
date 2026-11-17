import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vitest";
import { capabilityFixture, productCapabilityFixture } from "@/lib/capabilities.fixture";
import { botSwitchPatch } from "@/lib/capabilities";
import { setLocale } from "@/lib/i18n";
import { installedEntries } from "@/lib/installed-model";
import { buildPluginItems } from "@/lib/plugins-model";
import { InstalledView, type InstalledViewProps } from "./InstalledView";

const noop = () => {};
const entries = installedEntries(buildPluginItems({ servers: [{ name: "Historical entry", enabled: true, url: "https://example.test/mcp", auth: "connected" }] }));
const render = (extra: Partial<InstalledViewProps> = {}) => renderToStaticMarkup(createElement(InstalledView, {
  entries, skills: [], sourceLabel: (source) => source, onOpenEntry: noop, onOpenSkill: noop, entryActions: () => ({}), ...extra,
}));
beforeEach(() => setLocale("en"));

it("keeps a bot's Installed view on the resolver through loading, error and recovery", () => {
  const pending = render({ resolved: null });
  expect(pending).toContain('role="status"');
  expect(pending).not.toContain("Historical entry");
  const failed = render({ resolved: null, resolvedError: "offline", onRetryResolved: noop });
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Retry");
  expect(failed).not.toContain("Historical entry");
  const ready = render({ resolved: capabilityFixture() });
  expect(ready).toContain('data-capability="');
  expect(ready).not.toContain("Historical entry");
  expect(ready).not.toContain('role="alert"');
  // The organization scope still uses its own installation inventory.
  expect(render()).toContain("Historical entry");
});

it("#4359: draws the person's products at This bot as rows with this bot's own switch, on and off", () => {
  const data = capabilityFixture({ items: [
    productCapabilityFixture(),
    productCapabilityFixture({ key: "product:bot:edr", product: "edr", name: "Endpoint security", state: "off", enabled: false, reason: "disabled" }),
  ] });
  const flipped: Array<[string, boolean]> = [];
  const html = render({ resolved: data, onToggleBotSwitch: (item, next) => flipped.push([item.product!, next]) });
  expect(html).toContain('data-capability-product="psa"');
  expect(html).toContain('data-capability-product="edr"');
  expect(html.match(/role="switch"/g)?.length).toBe(2);
  expect(html).toMatch(/data-capability-product="edr"[^>]*data-capability-scope="bot" data-capability-state="off"/);
  expect(html).toContain("Product");
  // no switch without the bot's own switch handler (someone who may not change the bot)
  expect(render({ resolved: data }).match(/role="switch"/g)).toBeNull();
});

it("#4359: a product switch writes the bot's whole products map, as a built-in's writes builtinPlugins", () => {
  const bot = { builtinPlugins: { rea: false }, products: { psa: false } };
  expect(botSwitchPatch(bot, { product: "edr" }, false)).toEqual({ products: { psa: false, edr: false } });
  expect(botSwitchPatch(bot, { product: "psa" }, true)).toEqual({ products: { psa: true } });
  expect(botSwitchPatch(bot, { builtin: "rea" }, true)).toEqual({ builtinPlugins: { rea: true } });
  expect(botSwitchPatch(bot, {}, true)).toBeNull();
});

it("#4504: a failed update is said under the row that failed (by its update key), not only at the top", () => {
  const withKey = installedEntries(buildPluginItems({ servers: [
    { name: "Notes", enabled: true, url: "https://example.test/notes", auth: "connected", updateKey: "connector:me:me:Notes" },
    { name: "Search", enabled: true, url: "https://example.test/search", auth: "connected", updateKey: "connector:me:me:Search" },
  ] }));
  const html = render({
    entries: withKey,
    rowNotice: (keys) => keys.includes("connector:me:me:Search") ? createElement("p", { "data-test-notice": "" }, "failed") : null,
  });
  const notice = html.indexOf("data-test-notice");
  expect(notice).toBeGreaterThan(html.indexOf("Search"));
  expect(notice).toBeGreaterThan(html.indexOf('data-installed-entry="mcp:Search"'));
  // and under the Search row only: Notes comes before Search and has none after it
  expect(html.match(/data-test-notice/g)).toHaveLength(1);
  expect(html.indexOf("data-test-notice")).toBeLessThan(html.length);
});
