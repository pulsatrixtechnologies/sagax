// The iPhone app crashed the instant a chat opened (TestFlight 0.8.71,
// 0.8.153, 0.8.167): "Thread stack size exceeded due to excessive recursion"
// on the main thread, whose stack is 1 MB on a phone. The stack was eaten by
// SwiftUI's layout recursion, not by our own frames: every modifier whose
// body is a conditional (`@ViewBuilder` with `if #available`, `if` or
// `switch` around `content` or `self`) makes its result a dynamic list, and
// the next modifier wraps it in an implicit VStack. `.onValueChange` was one,
// and the chat screen chains it 33 times: 33 nested stacks between the
// screen's root and the transcript, each walked twice (size, then geometry)
// when the navigation push reads the new screen's preferences.
//
// This guard keeps the chain flat: `onValueChange` and `onValueChangePair`
// stay unary, no new conditional modifier helper appears without a line in
// the list below, no file applies those helpers more than a few times, and one
// file chains the observers no more than the measure tolerates. The runtime
// measure is ios/UITests/ChatOpenStackUITests.swift. Listed in GUARD_TESTS
// (scripts/verify/release/guard-tests.mjs), so every PR runs it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SOURCES = ["ios/App", "ios/AppShared", "ios/Shared"];

/** The conditional modifier helpers that exist, each applied a few times at
 * most. Make a new one unary instead (one modifier type on every OS), or add
 * it here with the reason a branch is needed. Never add `onValueChange`. */
export const ALLOWED_CONDITIONAL_HELPERS = [
  "feedback", // sensoryFeedback is iOS 17
  "rowSelectionDisabled", // selectionDisabled is iOS 17
  "sheetChromeCompat", // presentationBackground is iOS 16.4
  "pulseCompat", // symbolEffect is iOS 17
  "scrollAnchorCompat", // defaultScrollAnchor is iOS 17
  "scrollClipDisabledCompat", // scrollClipDisabled is iOS 17
  "onHardwareReturn", // onKeyPress is iOS 17
  "DesktopMenuTourAnchor", // the guided tour's anchor, iPad only
  "desktopPopoverOnCompact", // iPad shell only
  "sidebarBotPinSwipe", // the home list's swipe action
  "parityLauncher", // DEBUG parity harness
  "activityBackgroundTintCompat", // Live Activity, iOS 16.1
  "activitySystemActionForegroundColorCompat", // Live Activity, iOS 16.1
];

/** Helpers that a screen chains many times: they must never branch. */
export const ALWAYS_UNARY = ["OnValueChange", "OnValueChangePair", "onValueChange", "onValueChangePair"];

/** A file applies conditional helpers this many times at most: each one is a
 * nested stack on the main thread when the chain is laid out. */
export const MAX_CONDITIONAL_CALLS_PER_FILE = 3;

/** One screen chains the observer helpers this many times at most. They are
 * unary, so each one costs far less than a conditional, but it is still one
 * more body and one more modifier for the main thread to walk above the
 * transcript: the chat screen carries 33 today, and the measure
 * (ios/UITests/ChatOpenStackUITests.swift) stays the real budget. This only
 * catches a runaway chain before an archive does (#5159). */
export const MAX_OBSERVER_CALLS_PER_FILE = 40;

/** The helpers that observe a value: chained by name, never branched. */
export const OBSERVERS = ["onValueChange", "onValueChangePair"];

export type Helper = { name: string; kind: "extension" | "modifier"; file: string; line: number };

/** Blanks comments and string contents, keeping offsets and line breaks. */
export function stripSwift(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i++) out += text[i] === "\n" ? "\n" : " ";
    } else if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end < 0 ? text.length : end + 3;
      out += '"""';
      for (i += 3; i < stop - 3; i++) out += text[i] === "\n" ? "\n" : " ";
      out += '"""';
      i = stop;
    } else if (text[i] === '"') {
      out += '"';
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") { out += "  "; i += 2; continue; }
        out += " ";
        i++;
      }
      if (i < text.length) { out += text[i]; i++; }
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/** The text inside the braces that open at `open`. */
function braceBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;
const BRANCH = /\b(?:if|switch)\b/;
const SELF_HEAD = /^\s*(?:self|content)\b|^\s*\.[A-Za-z]|\{\s*(?:self|content)\b/m;

/** The conditional modifier helpers of one Swift file: `@ViewBuilder`
 * functions of `extension View` with a branch whose result is `self`, and
 * ViewModifiers whose `@ViewBuilder` body branches around `content`. */
export function conditionalHelpers(file: string, source: string): Helper[] {
  const text = stripSwift(source);
  const found: Helper[] = [];
  for (const ext of text.matchAll(/\bextension\s+View\b[^{]*\{/g)) {
    const start = ext.index! + ext[0].length;
    const body = braceBody(text, start - 1);
    for (const fn of body.matchAll(/@ViewBuilder\s+(?:(?:public|internal|fileprivate|private)\s+)?func\s+(\w+)[^{]*\{/g)) {
      const inner = braceBody(body, fn.index! + fn[0].length - 1);
      if (BRANCH.test(inner) && SELF_HEAD.test(inner)) {
        found.push({ name: fn[1], kind: "extension", file, line: lineAt(text, start + fn.index!) });
      }
    }
  }
  for (const mod of text.matchAll(/\bstruct\s+(\w+)(?:<[^>{]*>)?\s*:\s*[^{]*\bViewModifier\b[^{]*\{/g)) {
    const start = mod.index! + mod[0].length;
    const body = braceBody(text, start - 1);
    for (const fn of body.matchAll(/@ViewBuilder\s+(?:(?:public|internal|fileprivate|private)\s+)?func\s+body\s*\(\s*content\s*:\s*Content\s*\)[^{]*\{/g)) {
      const inner = braceBody(body, fn.index! + fn[0].length - 1);
      if (BRANCH.test(inner) && /^\s*content\b/m.test(inner)) {
        found.push({ name: mod[1], kind: "modifier", file, line: lineAt(text, start + fn.index!) });
      }
    }
  }
  return found;
}

/** The `extension View` functions that apply a conditional ViewModifier
 * (`modifier(Name(...))`): their call sites count as the modifier's. */
export function wrappers(file: string, source: string, modifiers: string[]): Helper[] {
  const text = stripSwift(source);
  const found: Helper[] = [];
  for (const ext of text.matchAll(/\bextension\s+View\b[^{]*\{/g)) {
    const start = ext.index! + ext[0].length;
    const body = braceBody(text, start - 1);
    for (const fn of body.matchAll(/func\s+(\w+)[^{]*\{/g)) {
      const inner = braceBody(body, fn.index! + fn[0].length - 1);
      const applied = /\bmodifier\(\s*(\w+)\s*\(/.exec(inner);
      if (applied && modifiers.includes(applied[1])) found.push({ name: fn[1], kind: "extension", file, line: lineAt(text, start + fn.index!) });
    }
  }
  return found;
}

/** How many times this file chains an observer helper. */
export function observerCalls(source: string): number {
  const text = stripSwift(source);
  return OBSERVERS.reduce((total, name) => total + (text.match(new RegExp(`\\.${name}\\(`, "g"))?.length ?? 0), 0);
}

/** `onValueChange` calls that pass `initial: true`. The argument list runs to
 * the `) {` that opens the closure, so a `)` inside `of:` does not cut it,
 * and a comment that only mentions the flag does not count. */
export function initialOnValueChangeCalls(source: string): number {
  const text = stripSwift(source);
  const mark = ".onValueChange(";
  let count = 0;
  let at = 0;
  while ((at = text.indexOf(mark, at)) !== -1) {
    const newline = text.indexOf(") {", at);
    const tight = text.indexOf("){", at);
    const ends = [newline, tight].filter((index) => index >= 0);
    const end = ends.length ? Math.min(...ends) : at + mark.length;
    if (/initial:\s*true/.test(text.slice(at, end))) count += 1;
    at += mark.length;
  }
  return count;
}

/** How many times this file applies one of the helpers. */
export function conditionalCalls(source: string, helpers: Helper[]): number {
  const text = stripSwift(source);
  let count = 0;
  for (const helper of helpers) {
    const call = helper.kind === "extension" ? new RegExp(`\\.${helper.name}\\(`, "g") : new RegExp(`\\b${helper.name}\\(`, "g");
    count += text.match(call)?.length ?? 0;
  }
  return count;
}

function swiftFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) swiftFiles(path, out);
    else if (name.endsWith(".swift")) out.push(path);
  }
  return out;
}

const files = SOURCES.flatMap((dir) => swiftFiles(join(root, dir))).map((path) => ({
  file: relative(root, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));
const found = files.flatMap(({ file, source }) => conditionalHelpers(file, source));
const modifierNames = found.filter((helper) => helper.kind === "modifier").map((helper) => helper.name);
const helpers = [...found, ...files.flatMap(({ file, source }) => wrappers(file, source, modifierNames))];

describe("iOS modifier chains stay flat (main thread stack, #5159)", () => {
  it("finds the helpers it is meant to find", () => {
    const sample = `
      extension View {
          @ViewBuilder
          func scrollAnchorCompat(_ anchor: UnitPoint) -> some View {
              if #available(iOS 17.0, *) {
                  defaultScrollAnchor(anchor)
              } else {
                  self
              }
          }
          @ViewBuilder
          func pinned() -> some View { if pinned { self.overlay(Pin()) } else { self } }
          @ViewBuilder
          func card() -> some View { if flag { Text("a") } }
      }
      private struct Branchy<V: Equatable>: ViewModifier {
          @ViewBuilder
          func body(content: Content) -> some View {
              if #available(iOS 17.0, *) {
                  content.onChange(of: value, initial: initial) { _, v in action(v) }
              } else {
                  content.onChange(of: value) { v in action(v) }
              }
          }
      }
      private struct Flat: ViewModifier {
          func body(content: Content) -> some View { content.onAppear {} }
      }`;
    expect(conditionalHelpers("sample.swift", sample).map((h) => h.name)).toEqual(["scrollAnchorCompat", "pinned", "Branchy"]);
    expect(conditionalCalls(".scrollAnchorCompat(.bottom).pinned().modifier(Branchy(value: 1))", conditionalHelpers("s", sample))).toBe(3);
    const wrapper = "extension View {\n    func branchy(_ v: Int) -> some View {\n        modifier(Branchy(value: v))\n    }\n}";
    expect(wrappers("w.swift", wrapper, ["Branchy"]).map((h) => h.name)).toEqual(["branchy"]);
  });

  it("keeps onValueChange and onValueChangePair unary", () => {
    const branching = helpers.filter((helper) => ALWAYS_UNARY.includes(helper.name));
    expect(branching, "a branch here nests one stack per call: the chat screen chains it 33 times").toEqual([]);
    const compat = stripSwift(readFileSync(join(root, "ios/App/BackDeployCompat.swift"), "utf8"));
    const onValueChange = /struct\s+OnValueChange<[^{]*\{/.exec(compat);
    expect(onValueChange, "OnValueChange is still a ViewModifier").not.toBeNull();
    expect(braceBody(compat, onValueChange!.index + onValueChange![0].length - 1)).not.toMatch(/#available|\bif\b|\bswitch\b/);
  });

  it("adds no conditional modifier helper outside the list", () => {
    const unknown = helpers.filter((helper) => !ALLOWED_CONDITIONAL_HELPERS.includes(helper.name)).map((h) => `${h.file}:${h.line} ${h.name}`);
    expect(unknown, "make it one modifier type on every OS, or list it with its reason").toEqual([]);
  });

  it("counts the observer chain of a file", () => {
    expect(observerCalls("x.onValueChange(of: a) {}.onValueChangePair(of: b) {}.modifier(OnValueChange(value: 1))")).toBe(2);
    expect(observerCalls("// .onValueChange(of: a) {}\nText(\".onValueChange(\")")).toBe(0);
    expect(initialOnValueChangeCalls(".onValueChange(of: box.frame(in: .global).minY, initial: true) { _ in }")).toBe(1);
    expect(initialOnValueChangeCalls(".onValueChange(of: a) { _ in }\n// initial: true\n.onValueChange(of: b, initial: true) { _ in }")).toBe(1);
  });

  // #5169: the words that name the budget and the chain match the code.
  // The applied budget stays nine tenths (943 713 of 1 048 576). The measured
  // peaks in ios/TESTING.md are unchanged: this does not move a threshold.
  it("names the chat-open budget and the modifier chain as they are", () => {
    const chat = files.find((file) => file.file === "ios/App/ChatView.swift");
    expect(chat, "ChatView.swift").toBeTruthy();
    const stripped = stripSwift(chat!.source);
    const valueChanges = stripped.match(/\.onValueChange\(/g)?.length ?? 0;
    const pairs = stripped.match(/\.onValueChangePair\(/g)?.length ?? 0;
    expect(valueChanges).toBe(33);
    expect(pairs).toBe(3);
    expect(observerCalls(chat!.source)).toBe(36);

    const compat = readFileSync(join(root, "ios/App/BackDeployCompat.swift"), "utf8");
    expect(compat).toContain("33 times");
    expect(compat).not.toContain("25 times");
    expect(compat).toContain("ten today");
    expect(compat).not.toMatch(/two call sites/);
    const initials = files.reduce((total, file) => total + initialOnValueChangeCalls(file.source), 0);
    expect(initials).toBe(10);

    const ui = readFileSync(join(root, "ios/UITests/ChatOpenStackUITests.swift"), "utf8");
    expect(ui).toContain("static let budget = deviceStack / 10 * 9");
    expect(ui).toContain("under nine tenths of that 1 MB");
    expect(ui).not.toMatch(/under half of that 1 MB/);

    const releasing = readFileSync(join(root, "docs/releasing.md"), "utf8");
    expect(releasing).toContain("nine tenths of a phone's 1 MB (943 713 bytes, #5159)");
    expect(releasing).not.toMatch(/passes half of a phone's 1 MB/);
  });

  it(`chains observer helpers at most ${MAX_OBSERVER_CALLS_PER_FILE} times per file`, () => {
    const heavy = files
      .map(({ file, source }) => ({ file, calls: observerCalls(source) }))
      .filter(({ calls }) => calls > MAX_OBSERVER_CALLS_PER_FILE)
      .map(({ file, calls }) => `${file}: ${calls}`);
    expect(heavy, "each one is a body and a modifier above the transcript").toEqual([]);
  });

  it(`applies conditional helpers at most ${MAX_CONDITIONAL_CALLS_PER_FILE} times per file`, () => {
    const heavy = files
      .map(({ file, source }) => ({ file, calls: conditionalCalls(source, helpers) }))
      .filter(({ calls }) => calls > MAX_CONDITIONAL_CALLS_PER_FILE)
      .map(({ file, calls }) => `${file}: ${calls}`);
    expect(heavy, "each call is one more nested stack when the screen is laid out").toEqual([]);
  });
});
