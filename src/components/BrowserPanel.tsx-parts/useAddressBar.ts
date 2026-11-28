// The live browser's address field [M-20261127-180]. It shows the page on
// screen except while the person edits it; Enter opens what they typed (a web
// address, or else a search) and, while the browser is busy (a take from the
// bot, an action still running), waits for it instead of calling a good
// address invalid. The error names only an empty or unusable entry and goes
// as soon as they type.
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { t } from "@/lib/i18n";
import { resolveAddressBarInput } from "@/lib/browser-address";
import { shownAddress } from "@/lib/browser-page";

export type AddressBar = {
  value: string;
  error: string;
  readOnly: boolean;
  change: (text: string) => void;
  focus: (field: { select: () => void }) => void;
  blur: () => void;
  /** Escape: back to the page's address. False when there was nothing to undo. */
  revert: () => boolean;
  submit: () => void;
};

export function useAddressBar({ address, setAddress, editing, page, field, canEdit, ready, navigate }: {
  address: string;
  setAddress: Dispatch<SetStateAction<string>>;
  /** The person changed the text since the field took focus: the stream's
   * page updates leave it alone. A field only focused still follows the page. */
  editing: RefObject<boolean>;
  /** The page's address as the stream last said it, or null before it said. */
  page: RefObject<string | null>;
  field: RefObject<HTMLInputElement | null>;
  /** The person may open a page here: connected, allowed, not held by another window. */
  canEdit: boolean;
  /** A toolbar command would run now: no take and no action under way. */
  ready: boolean;
  navigate: (url: string) => void;
}): AddressBar {
  const [error, setError] = useState("");
  // Asked for while the browser was busy: opened once it is free, the latest wins.
  const wanted = useRef("");
  // The last address sent, so a second Enter while it runs does not open it twice.
  const sent = useRef("");
  // Enter moves focus to the page on purpose: keep showing where it goes.
  const leaving = useRef(false);
  const pageAddress = () => shownAddress(page.current);
  const go = (url: string) => { sent.current = url; navigate(url); };
  useEffect(() => {
    if (!canEdit) { wanted.current = ""; sent.current = ""; setError(""); return; }
    if (!ready) return;
    const url = wanted.current;
    const repeat = url !== "" && url === sent.current;
    wanted.current = ""; sent.current = "";
    if (url && !repeat) go(url);
    // Free again with nothing waiting: show the page, whatever became of the last address.
    else if (!editing.current) setAddress(pageAddress());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, ready]);
  // Focused but not edited: the page's new address arrives selected, as on focus.
  useEffect(() => {
    const input = field.current;
    if (input && !editing.current && typeof document !== "undefined" && document.activeElement === input) input.select();
  }, [address, editing, field]);
  return {
    value: address,
    error,
    readOnly: !canEdit,
    change: (text) => { editing.current = true; setAddress(text); setError(""); },
    focus: (input) => { if (canEdit) input.select(); },
    blur: () => {
      editing.current = false;
      if (leaving.current) return;
      setError(""); setAddress(pageAddress());
    },
    revert: () => {
      const shown = pageAddress();
      if (address === shown && !error) return false;
      editing.current = false;
      setError(""); setAddress(shown); field.current?.select();
      return true;
    },
    submit: () => {
      if (!canEdit) return;
      const url = resolveAddressBarInput(address);
      if (!url) { setError(t("browser.address.invalid")); return; }
      setError(""); setAddress(url);
      editing.current = false;
      leaving.current = true;
      try { field.current?.blur(); } finally { leaving.current = false; }
      if (ready) go(url);
      else wanted.current = url;
    },
  };
}
