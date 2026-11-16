// A page of the app drawn inside another surface (#4420, #4470): the bot's
// profile page opens the Memory page in a modal stacked over Folder and
// memory's, as the reference app opens everything a bot page's button
// leads to. Hosted, the page draws no window strip and its own close
// closes the host; without a host, it draws itself as it always did (the
// main column's page).
import { createContext, useContext } from "react";

export type PageHost = {
  /** What the page's own close button does: close the host (the modal). */
  onClose: () => void;
};

const PageHostContext = createContext<PageHost | null>(null);
export const PageHostProvider = PageHostContext.Provider;

/** The surface a page is drawn in, or null when it stands on its own. */
export function usePageHost(): PageHost | null {
  return useContext(PageHostContext);
}
