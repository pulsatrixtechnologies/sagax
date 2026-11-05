import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DetachedEvent, DetachedSnapshot } from "./detached-protocol";
import type { RetroPrefs, RetroTip } from "./logic";
import { MENU_IDS, type Balloon, type BalloonModel, type MenuItem } from "./retro-assistant-shared";

type Bridge = NonNullable<Window["ogb"]>["retroAssistant"] | undefined;

/** Keep the always-on-top window in sync with the in-page brain. */
export function useRetroAssistantDetached(args: {
  bridge: Bridge;
  detached: boolean;
  prefsRef: MutableRefObject<RetroPrefs>;
  setPrefs: (update: (current: RetroPrefs) => RetroPrefs) => void;
  setBalloon: Dispatch<SetStateAction<Balloon | null>>;
  setDialog: Dispatch<SetStateAction<"options" | "gallery" | "custom" | null>>;
  model: BalloonModel | null;
  clickCharacter: () => void;
  pickMenu: (item: MenuItem) => void;
  runSearch: (text: string) => void;
  bulb: RetroTip | null;
  openTip: (tip: RetroTip | null) => void;
  snapshot: DetachedSnapshot | null;
}): void {
  const {
    bridge, detached, prefsRef, setPrefs, setBalloon, setDialog,
    model, clickCharacter, pickMenu, runSearch, bulb, openTip, snapshot,
  } = args;

  const handlers = useRef({
    model,
    click: clickCharacter,
    menu: pickMenu,
    search: runSearch,
    bulb: () => { if (bulb) openTip(bulb); },
  });
  handlers.current = {
    model,
    click: clickCharacter,
    menu: pickMenu,
    search: runSearch,
    bulb: () => { if (bulb) openTip(bulb); },
  };

  useEffect(() => {
    if (!bridge) return;
    void bridge.setDetached(detached).catch(() => undefined);
  }, [bridge, detached]);
  useEffect(() => () => void bridge?.setDetached(false).catch(() => undefined), [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const offChanged = bridge.onDetachedChanged((on) => {
      if (!on && prefsRef.current.detached) setPrefs((current) => ({ ...current, detached: false }));
    });
    const offEvent = bridge.onEvent((event: DetachedEvent) => {
      const current = handlers.current;
      if (event.type === "click") current.click();
      else if (event.type === "bulb") current.bulb();
      else if (event.type === "dismiss") setBalloon(null);
      else if (event.type === "options") { setBalloon(null); setDialog("options"); }
      else if (event.type === "search") current.search(event.query);
      else if (event.type === "menu") { if (MENU_IDS.has(event.id)) current.menu(event.id as MenuItem); }
      else if (event.type === "bullet") current.model?.bullets.find((item) => item.id === event.id)?.run();
      else if (event.type === "button") current.model?.buttons.find((item) => item.id === event.id)?.run();
    });
    return () => {
      offChanged();
      offEvent();
    };
  }, [bridge, setPrefs, prefsRef, setBalloon, setDialog]);

  const snapshotKey = snapshot ? JSON.stringify(snapshot) : "";
  useEffect(() => {
    if (bridge && snapshotKey) bridge.update(JSON.parse(snapshotKey) as DetachedSnapshot);
  }, [bridge, snapshotKey]);
}
