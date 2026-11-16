// A surface opened from another page as a page of that page (#4420): the
// bot's profile page opens Connect apps and Memory in its own ground, under
// its own top bar (the link back, Share and close), never as the centred
// window or by leaving the page. The host provides its top bar; without a
// host, each surface draws itself as it always did (Connect apps the
// centred window, Memory the main column's page).
import { createContext, useContext, type ReactNode } from "react";

export type PageHost = {
  /** The host page's top bar, drawn at the top of the hosted page. */
  header: ReactNode;
};

const PageHostContext = createContext<PageHost | null>(null);
export const PageHostProvider = PageHostContext.Provider;

/** The page a surface is drawn in, or null when it stands on its own. */
export function usePageHost(): PageHost | null {
  return useContext(PageHostContext);
}
