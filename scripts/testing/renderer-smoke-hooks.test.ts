// The hooks of the real-renderer smokes, held to the app's sources (#4316).
//
// A real-renderer smoke (scripts/testing/*.e2e.test.ts that drives the built
// app through control-omb or a browser) finds what it clicks by a data hook
// ("[data-model-option]"). The smokes run only in the complete run after a
// merge, and no check before a merge read their hooks: a lot that renames or
// drops a hook in src/ only showed up there (the provider page lost three
// hooks the smoke selects). This reads both sides as text, in a second:
// every data hook a smoke selects must still be written somewhere in src/
// outside its tests (as `data-x`, or as `dataset.x`). The fast gate runs it on a lot that touches src/ or a smoke
// (SOURCE_TEXT_TESTS and PARITY_PAIRS in scripts/verify/release/guard-tests.mjs);
// verify:merge runs it with the guards.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Smokes whose hooks are gone from the app today, reported in the output
 * until each smoke follows the current screen (#4363). An entry leaves when
 * its hook is alive again: the check fails while it stays listed. */
const REPORTED_DEAD_HOOKS: Record<string, string[]> = {
};

/** A smoke drives the real renderer: control-omb, a browser engine. */
const DRIVES_RENDERER = /\bcontrol-omb\b|\bchromium\b|\bplaywright\b|\bagent-browser\b/;

/** The data hooks a smoke's text selects: `[data-x`, in any selector. */
function selectedHooks(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(data-[a-z0-9-]+)/g)].map((match) => match[1]))].sort();
}

/** Whether the app's text writes a hook: `data-x` or `dataset.x`. */
function hookAlive(hook: string, app: string): boolean {
  const camel = hook.slice("data-".length).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return app.includes(hook) || app.includes(`dataset.${camel}`);
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css|html|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
};

describe("renderer smoke hooks", () => {
  const app = walk("src").map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
  const smokes = readdirSync(join(ROOT, "scripts", "testing"))
    .filter((name) => name.endsWith(".e2e.test.ts"))
    .map((name) => `scripts/testing/${name}`)
    .filter((file) => DRIVES_RENDERER.test(readFileSync(join(ROOT, file), "utf8")))
    .sort();

  it("finds the smokes and their hooks", () => {
    expect(smokes).toContain("scripts/testing/control-omb-ui.e2e.test.ts");
    expect(selectedHooks(readFileSync(join(ROOT, "scripts/testing/control-omb-ui.e2e.test.ts"), "utf8"))).toContain("data-model-option");
  });

  it("every hook a smoke selects is still written in src/", () => {
    const dead: string[] = [];
    const reported: string[] = [];
    for (const smoke of smokes) {
      const gone = selectedHooks(readFileSync(join(ROOT, smoke), "utf8")).filter((hook) => !hookAlive(hook, app));
      const known = REPORTED_DEAD_HOOKS[smoke] ?? [];
      for (const hook of gone) (known.includes(hook) ? reported : dead).push(`${smoke}: [${hook}]`);
    }
    if (reported.length) console.warn(`renderer smoke hooks: reported dead hooks (#4363), the smoke cannot find them:\n${reported.map((line) => `  ${line}`).join("\n")}`);
    expect(dead, "a smoke selects a hook no file of src/ writes any more: follow the screen in the smoke, or bring the hook back").toEqual([]);
  });

  it("a reported dead hook leaves its list once it is alive again", () => {
    const stale: string[] = [];
    for (const [smoke, hooks] of Object.entries(REPORTED_DEAD_HOOKS)) {
      let text = "";
      try { text = readFileSync(join(ROOT, smoke), "utf8"); } catch { stale.push(`${smoke}: the file is gone`); continue; }
      const selected = selectedHooks(text);
      for (const hook of hooks) if (!selected.includes(hook) || hookAlive(hook, app)) stale.push(`${smoke}: [${hook}]`);
    }
    expect(stale, "drop these entries from REPORTED_DEAD_HOOKS").toEqual([]);
  });

  it("reads a hook written as an attribute or through dataset", () => {
    expect(selectedHooks(`q('[data-model-menu] [data-model-option="a"]'); q("[data-model-menu]")`)).toEqual(["data-model-menu", "data-model-option"]);
    expect(hookAlive("data-model-option", `<button data-model-option={id}>`)).toBe(true);
    expect(hookAlive("data-computer-drag-id", `el.dataset.computerDragId = id`)).toBe(true);
    expect(hookAlive("data-model-picker-content", `<div data-model-menu>`)).toBe(false);
  });
});
