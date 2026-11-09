// A bare GIF / picture URL on a line of its own becomes an image node that the
// chat draws as the picture (the same MemeImage a person's sent GIF uses),
// keeping the text around it. `data-bare-image` tells the img renderer to use
// that look, not the gated "Load image" frame an author-written `![](url)` gets.
import { bareImageKind, type BareImageKind } from "../../shared/bare-image-urls.ts";

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[]; data?: Record<string, unknown> };

function linkUrl(node: MdNode | undefined): string | null {
  if (!node || node.type !== "link" || !node.url) return null;
  // a bare address: the label is the address itself (autolink / <url>)
  const label = node.children?.length === 1 && node.children[0]!.type === "text" ? node.children[0]!.value : undefined;
  return label !== undefined && label.trim() === node.url ? node.url : null;
}

const startsLine = (prev: MdNode | undefined) =>
  !prev || prev.type === "break" || (prev.type === "text" && /\n[ \t]*$/.test(prev.value ?? ""));
const endsLine = (next: MdNode | undefined) =>
  !next || next.type === "break" || (next.type === "text" && /^[ \t]*\n/.test(next.value ?? ""));

function pictureAt(kids: MdNode[], i: number): { url: string; kind: BareImageKind } | null {
  const url = linkUrl(kids[i]);
  const kind = url ? bareImageKind(url) : null;
  return url && kind && startsLine(kids[i - 1]) && endsLine(kids[i + 1]) ? { url, kind } : null;
}

function splitParagraph(paragraph: MdNode): MdNode[] | null {
  const kids = paragraph.children ?? [];
  if (!kids.some((_, i) => pictureAt(kids, i))) return null;
  const out: MdNode[] = [];
  let run: MdNode[] = [];
  const flush = () => {
    if (run.some((child) => child.type !== "text" || (child.value ?? "").trim())) out.push({ type: "paragraph", children: run });
    run = [];
  };
  let skipHead = false;
  kids.forEach((child, i) => {
    if (skipHead) {
      skipHead = false;
      if (child.type === "break") return;
      if (child.type === "text") {
        const value = (child.value ?? "").replace(/^[ \t]*\n/, "");
        if (value) run.push({ ...child, value });
        return;
      }
    }
    const hit = pictureAt(kids, i);
    if (!hit) {
      run.push(child);
      return;
    }
    const last = run.at(-1);
    if (last?.type === "text") {
      const value = (last.value ?? "").replace(/[ \t]*\n[ \t]*$/, "");
      if (value) run[run.length - 1] = { ...last, value };
      else run.pop();
    } else if (last?.type === "break") run.pop();
    flush();
    // a div, not a p: the picture is a figure, which a paragraph cannot hold
    out.push({
      type: "paragraph",
      data: { hName: "div" },
      children: [{ type: "image", url: hit.url, data: { hProperties: { "data-bare-image": hit.kind, alt: "" } } }],
    });
    skipHead = true;
  });
  flush();
  return out;
}

export function remarkBareImages() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "paragraph") return splitParagraph(child) ?? [child];
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
