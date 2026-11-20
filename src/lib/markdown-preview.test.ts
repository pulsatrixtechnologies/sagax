import { describe, expect, it } from "vitest";
import { markdownPreview } from "./markdown-preview";

// An invented note written the way the product stores one: an inline image
// with escaped brackets, bold, a phone link, escaped parentheses, and a
// signature of network icons that link elsewhere.
const NOTE = [
  "Bonjour,",
  "",
  "![\\[image\\]](https://desk.example.test/v4_6_release/api/inlineimages/acme/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d)",
  "**Est-ce que ce courriel est légitime?** Merci \\(urgent\\)",
  "Ada Lindqvist | [418 555-0142](tel:4185550142)",
  "[![\\[image\\]](https://desk.example.test/v4_6_release/api/inlineimages/acme/1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e)](https://social.example.test/acme)",
].join("\n");

describe("markdownPreview", () => {
  it("keeps the words of a note and drops its images, markers and addresses", () => {
    const text = markdownPreview(NOTE);
    expect(text).toBe("Bonjour,\nEst-ce que ce courriel est légitime? Merci (urgent)\nAda Lindqvist | 418 555-0142");
    expect(text).not.toMatch(/https?:|\*\*|\\[([]|!\[/);
  });

  it("never throws and keeps a text that is no Markdown at all", () => {
    expect(markdownPreview("")).toBe("");
    expect(markdownPreview("<div><b>unclosed")).toBe("<div><b>unclosed");
    expect(markdownPreview("**open bold and [half link](")).toContain("open bold");
  });
});
