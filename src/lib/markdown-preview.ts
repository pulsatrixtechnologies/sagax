// The words of a Markdown text for a one or two line preview (M-20261119-084):
// a hovered record card clamps a note to a line or two, where a rendered
// Markdown block cannot be cut cleanly. The text is parsed by the same
// Markdown parser the chat's renderer uses; emphasis markers, escapes and
// link addresses go, a link keeps its words, an image is left out (its alt
// and address are no words of the note), lines stay lines. Never throws: a
// text the parser cannot read is shown as it came.
import { fromMarkdown } from "mdast-util-from-markdown";

type Node = { type: string; value?: string; children?: Node[] };

const BLOCKS = new Set(["paragraph", "heading", "listItem", "blockquote", "code", "table", "tableRow", "thematicBreak", "html"]);

function words(node: Node, out: string[]): void {
  switch (node.type) {
    case "image":
    case "imageReference":
    case "definition":
      return;
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      out.push(node.value ?? "");
      break;
    case "break":
      out.push("\n");
      break;
    default:
      for (const child of node.children ?? []) words(child, out);
  }
  if (BLOCKS.has(node.type)) out.push("\n");
}

export function markdownPreview(text: string): string {
  try {
    const out: string[] = [];
    words(fromMarkdown(text) as Node, out);
    return out.join("").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  } catch {
    return text;
  }
}
