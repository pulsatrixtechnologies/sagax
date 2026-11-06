import { useState } from "react";
import type { BrowserFrame } from "../BrowserViewport";
import type { BrowserTakeStatus } from "@/lib/browser-control";
import type { TeachStep } from "../../../shared/teach-recording";

type BrowserTab = { tabId: string; title: string; url: string; active: boolean };
type ViewerFrame = BrowserFrame & { viewerId: string; generation: number };

/** UI flags for LiveBrowser: kept out of the main function so it stays under 400 lines. */
export function useLiveBrowserFlags() {
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<ViewerFrame | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [address, setAddress] = useState("");
  const [connected, setConnected] = useState(false);
  const [control, setControl] = useState({ held: false, controlling: false, owned: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showProfiles, setShowProfiles] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [takeStatus, setTakeStatus] = useState<BrowserTakeStatus>("");
  // The server keeps the view open while the bot's own command holds the browser.
  const [busy, setBusy] = useState(false);
  // Last useState of this component: the test fixture (BrowserPanel.test.ts)
  // seeds the earlier ones by call order.
  // The stream dropped and an automatic reconnect is under way (not a failure).
  const [reconnecting, setReconnecting] = useState(false);
  // The person's network debugger (never the bot's).
  const [showNetwork, setShowNetwork] = useState(false);
  // Teach by demonstration (server/browser/browser-teach.ts): a recording runs, then
  // its steps open in the editor. Never null: the test fixture gives every
  // useState(null) the frame.
  const [recording, setRecording] = useState(false);
  const [taught, setTaught] = useState<{ steps: TeachStep[]; recordedAt: string } | undefined>(undefined);
  const [teachNote, setTeachNote] = useState("");
  // Held on purpose: Take control, or a sign-in card's Open.
  const [kept, setKept] = useState(false);
  // The typing dialog is for a password or code: masked, never kept.
  const [masked, setMasked] = useState(false);
  return {
    attempt, setAttempt,
    frame, setFrame,
    tabs, setTabs,
    address, setAddress,
    connected, setConnected,
    control, setControl,
    pending, setPending,
    error, setError,
    showProfiles, setShowProfiles,
    showTyping, setShowTyping,
    viewport, setViewport,
    takeStatus, setTakeStatus,
    busy, setBusy,
    reconnecting, setReconnecting,
    showNetwork, setShowNetwork,
    recording, setRecording,
    taught, setTaught,
    teachNote, setTeachNote,
    kept, setKept,
    masked, setMasked,
  };
}
