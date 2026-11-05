/** Dispatched on window to open the palette from a control (the sidebar's
 * search field) rather than the ⌘K chord. Kept in its own module so the
 * launch path can call it without fetching CommandPalette.tsx. */
export const OPEN_PALETTE_EVENT = "omb:open-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
