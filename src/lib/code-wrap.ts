// Break opportunities for inline code: long paths and identifiers wrap at
// separators (`/`, `\`, `.`, `-`, `_`) instead of one glyph per line when a
// table cell or bubble is narrow.
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** Insert a zero-width space after path separators. `/` always; `\` only when
 * it starts a Windows path segment (letter, digit, `.`, `/`, `\`), so a LaTeX
 * escape like `\(a\)` stays intact. */
export function breakableCodeText(text: string): string {
  return text
    .replace(/\//g, "/\u200B")
    .replace(/\\(?=[A-Za-z0-9./\\])/g, "\\\u200B");
}

/** Walk react-markdown's inline code children and make string leaves wrap
 * at separators. Non-string nodes pass through unchanged. */
export function wrapCodeChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") return breakableCodeText(child);
    if (typeof child === "number") return breakableCodeText(String(child));
    if (Array.isArray(child)) return wrapCodeChildren(child);
    if (isValidElement(child)) {
      const element = child as ReactElement<{ children?: ReactNode }>;
      if (element.props.children == null) return child;
      return cloneElement(element, undefined, wrapCodeChildren(element.props.children));
    }
    return child;
  });
}
