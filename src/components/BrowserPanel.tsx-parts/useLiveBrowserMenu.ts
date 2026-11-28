// The live browser's ⋯ menu is a <details> [M-20261127-180]: Escape or a press
// outside closes it, as every small menu does (use-popover-dismiss), instead of
// staying open; the screen panel leaves an open one's Escape to it.
import { useRef, useState } from "react";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";

export function useLiveBrowserMenu() {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  usePopoverDismiss(open, root, () => { root.current?.removeAttribute("open"); setOpen(false); });
  return { root, toggled: setOpen };
}
