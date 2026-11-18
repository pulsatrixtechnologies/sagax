// The title of the bot page modal around a section (BotPageModal provides
// it): a section whose heading says the same words as the modal's title
// does not draw that heading a second time (the title already says it), it
// only keeps it for screen readers. A section with other words keeps its
// heading; its help and action stay either way.
import { createContext, useContext } from "react";

export const ModalTitleContext = createContext<string | null>(null);

const norm = (text: string) => text.trim().toLocaleLowerCase();

/** True when `heading` repeats the title of the modal this section is in. */
export function repeatsModalTitle(modalTitle: string | null, heading: unknown): boolean {
  return modalTitle !== null && typeof heading === "string" && norm(heading) === norm(modalTitle);
}

export function useRepeatsModalTitle(heading: unknown): boolean {
  return repeatsModalTitle(useContext(ModalTitleContext), heading);
}
