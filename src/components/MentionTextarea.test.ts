import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MentionTextarea } from "./MentionTextarea";

it.each(["auto", "rtl", "ltr"])("shares the %s direction between the native input and its mirror", (dir) => {
  const html = renderToStaticMarkup(createElement(MentionTextarea, {
    inputRef: createRef<HTMLTextAreaElement>(), dir, readOnly: true,
    value: "مرحبا @Atlas\nEnglish @Atlas\nשלום @Atlas",
    peers: [{ name: "Atlas", color: "blue" }],
  }));
  expect(html).toContain(`<div dir="${dir}" aria-hidden="true" class="mention-editor-mirror`);
  expect(html).toContain(`<textarea dir="${dir}"`);
  expect(html.match(/class="mention-highlight"/g)).toHaveLength(3);
});

// The mirror paints the text over a transparent textarea, so both must take
// their size from one rule, and a phone must get at least 16 px (iOS Safari
// zooms the page when a smaller field takes focus).
it("sizes the composer and its mirror from one rule, 14 px, 16 px on touch screens", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const composer = readFileSync(new URL("./Composer.tsx-parts/ComposerEditor.tsx", import.meta.url), "utf8");
  expect(css).toMatch(/\.chat-input-text,\s*\.mention-editor-mirror\s*\{\s*font-size: 14px;\s*line-height: 20px;/);
  expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.chat-input-text,\s*\.mention-editor-mirror\s*\{\s*font-size: 16px;\s*line-height: 24px;/);
  expect(css.match(/\.mention-editor-mirror\s*\{[^}]*\}/)?.[0]).not.toMatch(/font-size|line-height/);
  expect(composer).toMatch(/className="[^"]*\bchat-input-text\b[^"]*"/);
  expect(composer).not.toMatch(/text-\[14px\] leading-5 placeholder/);
});

// Typing used to set height to auto and read scrollHeight on every keystroke
// (a forced layout). Where the browser can size the field itself it does.
it("lets the browser size the field when it can, and keeps the measured fallback", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("./MentionTextarea.tsx", import.meta.url), "utf8");
  expect(css).toMatch(/@supports \(field-sizing: content\) \{\s*\.mention-editor textarea \{\s*field-sizing: content;\s*max-height: 6lh;/);
  expect(source).toContain('CSS.supports("field-sizing", "content")');
  expect(source).toMatch(/const resize = useCallback\(\(\) => \{[\s\S]*?if \(FIELD_SIZING\) return;[\s\S]*?input\.style\.height = "auto";/);
});
