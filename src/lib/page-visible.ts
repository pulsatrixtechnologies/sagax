import { useEffect, useState } from "react";

/** Whether the document is visible. Poll-style effects include this in their
 * deps so a hidden window tears its interval down instead of capturing
 * screenshots nobody can see, and reads again at once when it shows. A server
 * render (no document) counts as visible. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
