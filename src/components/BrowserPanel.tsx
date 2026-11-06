import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { Globe } from "lucide-react";
import { BrowserUnavailableNote } from "./SettingsLink";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot } from "@/state/store";
import { createBrowserInputQueue } from "@/lib/browser-input-queue";
import { createBrowserControl, type BrowserInteraction } from "@/lib/browser-control";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { browserDot, reportScreenDot } from "@/lib/screen-status";
import { ComputerScreen, type ScreenAction } from "./computer/ComputerScreen";
import { SandboxDesktopModal } from "./computer/SandboxDesktopModal";import { onBrowserTeachRequest, takeBrowserTeach } from "@/lib/teach-request";
import type { TeachStep } from "../../shared/teach-recording";
import { readableError } from "@/lib/plain-error";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useAnchoredDismissRoot } from "./AnchoredPopover";
import { LiveBrowserView } from "./BrowserPanel.tsx-parts/LiveBrowserView";
import { useLiveBrowserFlags } from "./BrowserPanel.tsx-parts/useLiveBrowserFlags";

interface BrowserTab { tabId: string; title: string; url: string; active: boolean }
const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000];
const NO_CONTROL = { held: false, controlling: false, owned: false };
/** Where the window takes a browser that shows a blank page (the server
 * launches a closed one there too: BROWSER_START_URL in server/browser/browser-live.ts). */
export const BROWSER_START_URL = "https://www.google.com/";

/** A sign-in card's Open: take the browser for the person at once, and open
 * the site when the bot left the page blank (src/state/store.tsx signInFocus). */
export type BrowserSignIn = { url: string; site: string; nonce: number };

/** Closing a panel releases its lease. A new connection never silently
 * restores permission to type, and never replays old browser frames.
 * Interacting takes the browser from the bot, and a few idle seconds hand it
 * back (see createBrowserControl). The bar under the address says who has
 * the browser, with Take control (kept until handed back) and Give back.
 * An open sign-in request for this browser also keeps the person's hold,
 * and `signIn` (a sign-in card's Open) takes the browser at once.
 * `control`: false hands the browser back at once and leaves the page
 * view-only. `placeholder`: the preview's last picture, shown dimmed while
 * the live view connects, so the window never opens on an empty square. */
export function LiveBrowser({ bot, control: allowed = true, placeholder, teach = false, signIn }: { bot: Bot; control?: boolean; placeholder?: string | undefined; teach?: boolean; signIn?: BrowserSignIn | undefined }) {
  const confirm = useConfirm();
  const { state } = useStore();
  const {
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
  } = useLiveBrowserFlags();
  const viewer = useRef("");
  const generation = useRef(0);
  const pendingOperation = useRef<number | null>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const profilesButton = useRef<HTMLButtonElement>(null);
  const profilesPopover = useRef<HTMLDivElement>(null);
  const typingPopover = useRef<HTMLDivElement>(null);
  const typingField = useRef<HTMLInputElement>(null);
  const menuSummary = useRef<HTMLElement>(null);
  const inputQueue = useRef<ReturnType<typeof createBrowserInputQueue> | null>(null);
  const browserControl = useRef<ReturnType<typeof createBrowserControl> | null>(null);
  // The latest server control state, for callbacks that outlive a render.
  const controlNow = useRef(NO_CONTROL);
  const allowedNow = useRef(allowed);
  const haltMessage = useRef("");
  const urlEditing = useRef(false);
  const reconnectCount = useRef(0);
  const connectionProfile = useRef("");
  // Once per connection: a blank page is taken to the start page.
  const startChecked = useRef(false);
  // The recording, for callbacks that outlive a render: its start time, the
  // view that started it (discarded with the window), and whether this
  // window was opened to record (the composer's Teach a task).
  const recordingNow = useRef(false);
  const recordedAt = useRef("");
  const recordingViewer = useRef("");
  const autoTeach = useRef(teach);
  const startRecordingNow = useRef<() => void>(() => {});
  // Whether the hold must outlast idle time, for a control created later.
  const keepNow = useRef(false);
  // The last sign-in Open acted on, and its site to open once the page is known.
  const signInHandled = useRef(0);
  const signInPage = useRef<string | null>(null);
  const signInNow = useRef(signIn);
  signInNow.current = signIn;
  // The page's address as the stream last said, or null before it said.
  const pageNow = useRef<string | null>(null);
  // An open sign-in request for this browser keeps the person's hold.
  const signInOpen = state.computerControl?.[bot.id]?.help?.place === "browser";
  keepNow.current = kept || signInOpen;
  const profileName = bot.browserProfile === "guest" ? t("browser.profile.temporary")
    : bot.browserProfile === "my-chrome" ? t("settings.profiles.myChrome")
    : state.config?.browserProfiles?.find((profile) => profile.id === bot.browserProfile)?.name ?? t("browser.profile.own", { name: bot.name });
  // 2026-11-01 lot 7: profile and typing choices are anchored popovers on the bar.
  const profilesDismiss = useAnchoredDismissRoot(profilesButton, profilesPopover);
  const typingDismiss = useAnchoredDismissRoot(menuSummary, typingPopover);
  usePopoverDismiss(showProfiles, profilesDismiss, () => setShowProfiles(false));
  usePopoverDismiss(showTyping, typingDismiss, () => setShowTyping(false));
  useEffect(() => {
    // Typed text goes to the field the person picked, so keep control while they write it.
    browserControl.current?.hold(showTyping);
    if (!showTyping || typeof requestAnimationFrame !== "function") return;
    const frame = requestAnimationFrame(() => typingField.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [showTyping]);

  const action = useCallback(async (body: Record<string, unknown>, expected = viewer.current) => {
    if (!expected) throw new Error(t("browser.live.openFirst"));
    // 120s matches the server's browser requestTimeoutMs: restart replies can
    // be legitimately slow (see the reconnect note in the stream error
    // handler), but a wedged request must surface an error instead of
    // leaving the panel pending forever.
    return api(`/api/bots/${encodeURIComponent(bot.id)}/browser/action`, { method: "POST", body: JSON.stringify({ ...body, viewerId: expected }), timeoutMs: 120_000 });
  }, [bot.id]);
  const interact = useCallback((item: BrowserInteraction) => {
    // Another window's hold is never contested from here; the server refuses it too.
    if (controlNow.current.held && !controlNow.current.owned) return;
    browserControl.current?.interact(item);
  }, []);
  const input = useCallback((body: Record<string, unknown>) => interact({ input: body }), [interact]);
  const command = (body: Record<string, unknown>) => interact({ command: body });
  const reconnect = useCallback(() => {
    // Invalidate synchronously: an old request may finish before React runs
    // the effect cleanup for this reconnect.
    generation.current++;
    reconnectCount.current = 0;
    viewer.current = "";
    inputQueue.current?.clear(); inputQueue.current = null;
    browserControl.current?.close(); browserControl.current = null;
    pendingOperation.current = null;
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    const ownsConnection = () => generation.current === current;
    const profile = JSON.stringify([bot.id, bot.browserProfile]);
    if (connectionProfile.current !== profile) {
      connectionProfile.current = profile;
      reconnectCount.current = 0;
    }
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    viewer.current = ""; pendingOperation.current = null; haltMessage.current = "";
    urlEditing.current = false; startChecked.current = false; pageNow.current = null;
    setFrame(null); setTabs([]); setAddress(""); setConnected(false); setError(""); setReconnecting(false); setBusy(false);
    setControl({ held: false, controlling: false, owned: false }); setPending(false);
    controlNow.current = NO_CONTROL; setTakeStatus("");
    const source = new EventSource(`/api/bots/${encodeURIComponent(bot.id)}/browser/live`);
    const listen = (name: string, handler: (data: any) => void) => source.addEventListener(name, (event) => {
      if (stopped || !ownsConnection()) return;
      try { handler(JSON.parse((event as MessageEvent).data)); } catch { /* Malformed events are not rendered. */ }
    });
    listen("waiting", () => { if (!viewer.current) setBusy(true); });
    listen("ready", (data) => {
      if (typeof data.viewerId !== "string" || !data.viewerId) return;
      setBusy(false);
      const expected = data.viewerId;
      viewer.current = expected;
      const queue = createBrowserInputQueue(async (body) => {
        if (ownsConnection() && viewer.current === expected) await action(body, expected);
      }, (cause) => {
        if (!ownsConnection() || viewer.current !== expected) return;
        haltMessage.current = readableError(cause);
        setError(haltMessage.current);
      });
      inputQueue.current = queue;
      browserControl.current = createBrowserControl({
        queue,
        take: () => action({ type: "take" }, expected),
        release: () => action({ type: "release" }, expected),
        command: (body) => execute(body),
        busy: () => pendingOperation.current !== null,
        owned: () => controlNow.current.owned,
        onTakeStatus: setTakeStatus,
        onError: setError,
        onHalted: () => setError(haltMessage.current),
      });
      setReconnecting(false);
      browserControl.current.keep(keepNow.current);
      setConnected(true);
      if (recordingNow.current) recordingViewer.current = expected;
      if (autoTeach.current && allowedNow.current) { autoTeach.current = false; startRecordingNow.current(); }
    });
    // A ready event alone is not recovery: a flapping stream can open and
    // fail immediately. Reset the retry budget only after a live heartbeat.
    listen("heartbeat", () => { reconnectCount.current = 0; });
    listen("frame", (data) => { if (viewer.current) setFrame({ ...data, viewerId: viewer.current, generation: current }); });
    listen("tabs", (data) => {
      if (!Array.isArray(data.tabs)) return;
      setTabs(data.tabs);
      const active = data.tabs.find((tab: BrowserTab) => tab.active);
      if (active && !urlEditing.current) setAddress(active.url === "about:blank" ? "" : active.url);
      if (active) { pageNow.current = active.url; openSignInPage(); }
      // The person opened the window on a browser with nothing in it: start
      // where a browser starts, not on a white page. Never moves a real page.
      if (!startChecked.current && active) {
        startChecked.current = true;
        // A sign-in card's Open still to act on takes a blank page to its site instead.
        const signInWaiting = signInPage.current !== null || (signInNow.current !== undefined && signInHandled.current !== signInNow.current.nonce);
        if (allowedNow.current && !signInWaiting && isBlankPage(active.url)) browserControl.current?.interact({ command: { type: "navigate", url: BROWSER_START_URL } });
      }
    });
    listen("url", (data) => {
      if (typeof data.url !== "string") return;
      if (!urlEditing.current) setAddress(data.url === "about:blank" ? "" : data.url);
      pageNow.current = data.url; openSignInPage();
    });
    listen("status", (data) => {
      if (data.viewportWidth > 0 && data.viewportHeight > 0) setViewport({ width: data.viewportWidth, height: data.viewportHeight });
    });
    listen("control", (data) => {
      // Handed back from elsewhere (Done on the sign-in card): no longer held on purpose.
      if (controlNow.current.owned && !data.owned) setKept(false);
      controlNow.current = data;
      setControl(data);
      // Only another window's hold hides the page; this viewer's own take
      // keeps it visible while the bot finishes.
      if (data.held && !data.owned) { setFrame(null); setTabs([]); setAddress(""); }
      browserControl.current?.observe();
    });
    source.addEventListener("error", (event) => {
      // A closed source may still deliver its queued error after a profile
      // switch or reconnect. It must not clear the replacement viewer/input.
      if (stopped || !ownsConnection()) return;
      stopped = true;
      let message = t("browser.live.ended");
      let retryable = !(event instanceof MessageEvent);
      if (event instanceof MessageEvent) {
        try {
          const data = JSON.parse(event.data);
          message = data.message || message;
          retryable = data.retryable === true;
        } catch { /* Malformed server errors require explicit reconnect. */ }
      }
      const delay = retryable ? RECONNECT_DELAYS[reconnectCount.current] : undefined;
      if (delay !== undefined) {
        reconnectCount.current++;
        message = t("browser.live.reconnecting");
        reconnectTimer = setTimeout(() => {
          if (!ownsConnection()) return;
          // Reopen observation only, not browser commands or a human lease.
          generation.current++;
          setAttempt((value) => value + 1);
        }, delay);
      }
      setError(message); setReconnecting(delay !== undefined); setBusy(false); setConnected(false); setFrame(null); setControl({ held: false, controlling: false, owned: false });
      controlNow.current = NO_CONTROL; setTakeStatus("");
      // Keep this generation alive: a successful restart closes its stream
      // before the action reply arrives, and must still reconnect afterward.
      viewer.current = ""; inputQueue.current?.clear(); inputQueue.current = null;
      browserControl.current?.close(); browserControl.current = null; source.close();
    });
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (ownsConnection()) {
        // Closing the panel hands control back before the connection ends;
        // held or unsent input is left to the server's disconnect cleanup.
        browserControl.current?.leave();
        browserControl.current?.close(); browserControl.current = null;
        generation.current++; viewer.current = ""; pendingOperation.current = null;
        inputQueue.current?.clear(); inputQueue.current = null;
      }
      source.close();
    };
  }, [bot.id, bot.browserProfile, attempt, action]);

  // Take control and an open sign-in keep the hold past idle time.
  useEffect(() => { browserControl.current?.keep(kept || signInOpen); }, [kept, signInOpen]);
  const takeControl = () => { setKept(true); browserControl.current?.takeNow(); };
  const handBack = () => { setKept(false); browserControl.current?.handBack(); };
  // A sign-in card's Open: the person has the browser at once, at the bot's
  // page — or at the site, when the bot left the page blank.
  useEffect(() => {
    if (!signIn || !connected || !allowedNow.current || signInHandled.current === signIn.nonce) return;
    signInHandled.current = signIn.nonce;
    signInPage.current = signIn.url;
    takeControl();
    openSignInPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signIn, connected]);
  function openSignInPage() {
    const url = signInPage.current;
    if (!url || pageNow.current === null) return;
    signInPage.current = null;
    // The site, not the start page, is where a blank browser goes now.
    startChecked.current = true;
    if (isBlankPage(pageNow.current)) interact({ command: { type: "navigate", url } });
  }

  // Closing the window ends a recording: nothing of it is kept (the server
  // also drops one whose person has no view of the browser left).
  useEffect(() => () => {
    if (recordingNow.current && recordingViewer.current) void action({ type: "record-discard" }, recordingViewer.current).catch(() => {});
    recordingNow.current = false;
  }, [action]);
  const startRecording = async () => {
    setTeachNote(""); setError("");
    try {
      await action({ type: "record-start" });
      recordingNow.current = true; recordingViewer.current = viewer.current;
      recordedAt.current = new Date().toISOString();
      setRecording(true);
      // the demonstration is the person's: keep control until they stop
      browserControl.current?.takeNow();
    } catch (cause) { setError(readableError(cause)); }
  };
  startRecordingNow.current = () => { void startRecording(); };
  const stopRecording = async () => {
    try {
      // the last keys typed belong to the recording
      await inputQueue.current?.drain();
      const result = await action({ type: "record-stop" }) as { steps?: TeachStep[]; expired?: boolean };
      recordingNow.current = false; recordingViewer.current = "";
      setRecording(false);
      if (result.expired) setTeachNote(t("teach.expired"));
      else if (!result.steps?.length) setTeachNote(t("teach.nothing"));
      else setTaught({ steps: result.steps, recordedAt: recordedAt.current });
    } catch (cause) { setError(readableError(cause)); }
  };

  // Release control in the window: hand the browser back now, not after the idle wait.
  allowedNow.current = allowed;
  useEffect(() => { if (!allowed) browserControl.current?.handBack(); }, [allowed]);

  const execute = async (body: Record<string, unknown>) => {
    if (pendingOperation.current !== null) return;
    const expected = viewer.current;
    const current = generation.current;
    const queue = inputQueue.current;
    pendingOperation.current = current;
    setPending(true); setError("");
    try {
      await queue?.drain();
      if (generation.current !== current || viewer.current !== expected) return;
      await action(body, expected);
      // A halted queue silently drops input; restore the banner the
      // setError("") above cleared so the view does not look interactive.
      if (inputQueue.current?.stopped() && generation.current === current) setError(haltMessage.current);
      if (generation.current === current && body.type === "restart") reconnect();
    }
    catch (cause) { if (generation.current === current) setError(readableError(cause)); }
    finally {
      if (generation.current === current && pendingOperation.current === current) {
        pendingOperation.current = null; setPending(false);
      }
    }
  };
  const heldElsewhere = control.held && !control.owned;
  const interactive = allowed && connected && !heldElsewhere && !pending;
  const typingReady = interactive && control.owned && control.controlling;
  const taking = takeStatus === "pending" || takeStatus === "slow";
  const commandsReady = interactive && !taking;
  const pill = "flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border bg-menu px-2.5 py-1 text-[11px] shadow-sm sm:text-[12px]";
  const mine = control.owned && control.controlling;
  const pageTitle = tabs.find((tab) => tab.active)?.title ?? "";
  const holder = mine ? t("sandboxDesktop.controlling") : heldElsewhere ? t("browser.live.heldElsewhere")
    : taking ? t("browser.control.waiting", { name: bot.name }) : t("browser.control.bot", { name: bot.name });
  return <LiveBrowserView
    bot={bot}
    allowed={allowed}
    placeholder={placeholder}
    frame={frame}
    tabs={tabs}
    address={address}
    setAddress={setAddress}
    connected={connected}
    control={control}
    pending={pending}
    error={error}
    showProfiles={showProfiles}
    setShowProfiles={setShowProfiles}
    showTyping={showTyping}
    setShowTyping={setShowTyping}
    masked={masked}
    setMasked={setMasked}
    takeControl={takeControl}
    handBack={handBack}
    viewport={viewport}
    takeStatus={takeStatus}
    busy={busy}
    reconnecting={reconnecting}
    showNetwork={showNetwork}
    setShowNetwork={setShowNetwork}
    recording={recording}
    taught={taught}
    setTaught={setTaught}
    teachNote={teachNote}
    addressInput={addressInput}
    profilesButton={profilesButton}
    profilesPopover={profilesPopover}
    typingPopover={typingPopover}
    typingField={typingField}
    menuSummary={menuSummary}
    profileName={profileName}
    interactive={interactive}
    typingReady={typingReady}
    commandsReady={commandsReady}
    heldElsewhere={heldElsewhere}
    taking={taking}
    mine={mine}
    pageTitle={pageTitle}
    holder={holder}
    pill={pill}
    generation={generation}
    viewer={viewer}
    browserControl={browserControl}
    urlEditing={urlEditing}
    command={command}
    input={input}
    reconnect={reconnect}
    execute={execute}
    startRecording={startRecording}
    stopRecording={stopRecording}
    action={action}
    confirm={confirm}
    setError={setError}
  />;
}

type PreviewState = "connecting" | "busy" | "live" | "offline" | "error";
type PreviewFrame = { seq: number; src: string; viewerId: string };
/** A closed browser or a failed preview is asked again this often. */
const PREVIEW_RETRY_MS = 10_000;

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** The Computer tab's live view of the bot's browser, like the VM's square:
 * the same screencast as the take-control window, watch-only on the server
 * (`?preview=1`: no launch, a lower frame rate, acknowledgements only). A
 * closed browser is not opened just to be watched; it is asked again later. */
export function useBrowserPreview(bot: Bot, enabled: boolean) {
  const visible = usePageVisible();
  const [state, setState] = useState<PreviewState>("connecting");
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The page the browser shows: a running browser on a blank page is drawn
  // as "nothing open", not as a white rectangle.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setFrame(null);
    setUrl(null);
    if (!enabled || !visible) return;
    let stopped = false;
    let viewerId = "";
    let retry: ReturnType<typeof setTimeout> | undefined;
    setState("connecting");
    const source = new EventSource(`/api/bots/${encodeURIComponent(bot.id)}/browser/live?preview=1`);
    const end = (next: PreviewState) => {
      if (stopped) return;
      stopped = true;
      source.close();
      setFrame(null);
      setState(next);
      retry = setTimeout(() => setAttempt((value) => value + 1), PREVIEW_RETRY_MS);
    };
    const listen = (name: string, handler: (data: any) => void) => source.addEventListener(name, (event) => {
      if (stopped) return;
      try { handler(JSON.parse((event as MessageEvent).data)); } catch { /* Malformed events are not rendered. */ }
    });
    listen("waiting", () => setState("busy"));
    listen("ready", (data) => { if (typeof data.viewerId === "string") viewerId = data.viewerId; });
    listen("tabs", (data) => {
      const active = Array.isArray(data.tabs) ? data.tabs.find((tab: BrowserTab) => tab?.active) : undefined;
      setUrl(typeof active?.url === "string" ? active.url : "");
    });
    listen("url", (data) => { if (typeof data.url === "string") setUrl(data.url); });
    listen("frame", (data) => {
      if (!viewerId || typeof data.seq !== "number" || typeof data.data !== "string") return;
      setFrame({ seq: data.seq, viewerId, src: `data:image/${data.format === "png" ? "png" : "jpeg"};base64,${data.data}` });
      setState("live");
    });
    listen("offline", () => end("offline"));
    source.addEventListener("error", () => end("error"));
    return () => { stopped = true; clearTimeout(retry); source.close(); };
  }, [bot.id, bot.browserProfile, enabled, visible, attempt]);
  // The server paces frames on acknowledgements: one per frame shown.
  const acknowledge = useCallback((shown: PreviewFrame) => {
    void api(`/api/bots/${encodeURIComponent(bot.id)}/browser/action`, { method: "POST", body: JSON.stringify({ type: "ack", seq: shown.seq, viewerId: shown.viewerId }) }).catch(() => {});
  }, [bot.id]);
  return { state, frame, acknowledge, blank: url !== null && isBlankPage(url), retry: () => setAttempt((value) => value + 1) };
}

/** A page with nothing on it: the browser runs, but no site is open. */
export function isBlankPage(url: string): boolean {
  const trimmed = url.trim();
  return trimmed === "" || trimmed === "about:blank" || trimmed.startsWith("chrome://newtab") || trimmed.startsWith("chrome://new-tab-page");
}

/** Acknowledges a frame that is not drawn (a blank page), so the server keeps
 * pacing frames and the picture comes back when a page opens. */
function FrameAck({ frame, acknowledge }: { frame: PreviewFrame; acknowledge: (frame: PreviewFrame) => void }) {
  useEffect(() => { const tick = requestAnimationFrame(() => acknowledge(frame)); return () => cancelAnimationFrame(tick); }, [frame, acknowledge]);
  return null;
}

function PreviewImage({ frame, alt, acknowledge }: { frame: PreviewFrame; alt: string; acknowledge: (frame: PreviewFrame) => void }) {
  // Acknowledge after the frame is painted (identical pixels fire no load event).
  useEffect(() => { const tick = requestAnimationFrame(() => acknowledge(frame)); return () => cancelAnimationFrame(tick); }, [frame, acknowledge]);
  // Live picture only: ComputerScreen draws the centered Open pill on hover.
  return <div data-browser-preview="" className="absolute inset-0">
    <img src={frame.src} alt={alt} draggable={false} className="h-full w-full select-none object-contain" />
  </div>;
}

/** Sign-in Opens already acted on, by nonce (src/state/store.tsx signInFocus). */
const handledSignIns = new Set<number>();

/** The bot's browser on the Computer tab, drawn as the VM's screen: a live
 * preview in the same frame, and Take control opens the same window as the
 * server environment's (SandboxDesktopModal), where LiveBrowser connects.
 * While that window is open the square shows no second stream. */
export function BrowserComputerScreen({ bot, signIn }: { bot: Bot; signIn?: BrowserSignIn | undefined }) {
  const [takeover, setTakeover] = useState(() => takeBrowserTeach(bot.id));
  // Opened from the composer's Teach a task: the window starts recording.
  const [teach, setTeach] = useState(takeover);
  useEffect(() => onBrowserTeachRequest((botId) => {
    if (botId !== bot.id || !takeBrowserTeach(bot.id)) return;
    setTeach(true); setTakeover(true);
  }), [bot.id]);
  // A sign-in card's Open: the window opens and takes the browser there,
  // once per Open (a screen drawn again later does not reopen it).
  const [openSignIn, setOpenSignIn] = useState<BrowserSignIn | undefined>(undefined);
  useEffect(() => {
    if (!signIn || handledSignIns.has(signIn.nonce)) return;
    handledSignIns.add(signIn.nonce);
    setOpenSignIn(signIn); setTakeover(true);
  }, [signIn]);
  const preview = useBrowserPreview(bot, !takeover);
  const caption = t("computer.browserOf", { name: bot.name });
  // The last picture, shown in the window while its live view connects.
  const lastFrame = useRef<string | undefined>(undefined);
  if (preview.frame && !preview.blank) lastFrame.current = preview.frame.src;
  const open = () => setTakeover(true);
  // The bot waits on the person (sign-in, captcha): keep Open in view.
  const waiting = bot.tasks?.some((task) => task.activity === "waiting-on-you") === true;
  // The picker's dot: green while a browser session is live, neutral otherwise.
  const session = takeover || preview.state === "busy" || (preview.state === "live" && Boolean(preview.frame) && !preview.blank);
  useEffect(() => { reportScreenDot(`browser:${bot.id}`, browserDot(session)); }, [bot.id, session]);
  const message = preview.state === "error" ? t("browser.preview.failed")
    : preview.state === "busy" ? t("browser.preview.busy", { name: bot.name })
    : undefined;
  const actions: ScreenAction[] = preview.state === "error"
    ? [{ label: t("computerScreen.retry"), onClick: preview.retry }, { label: t("computerScreen.open"), onClick: open }]
    : [];
  // Offline → calm asleep. Connecting/busy → waking. Live frame (a blank page
  // included, so Open stays reachable) → running;
  // ComputerScreen owns the centered Open pill (no second overlay here).
  const screenState: ScreenState = takeover || (preview.state === "live" && preview.frame) ? "running"
    : preview.state === "offline" ? "off"
    : preview.state === "error" ? "error"
    : "starting";
  const live = takeover
    ? <div data-browser-takeover-open="" className="flex h-full w-full items-center justify-center p-4 text-center text-[12px] text-ink-secondary">{t("sandboxDesktop.inWindow")}</div>
    : preview.frame && preview.blank
      ? <div data-browser-blank="" className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FrameAck frame={preview.frame} acknowledge={preview.acknowledge} />
        <Globe size={28} aria-hidden="true" className="text-ink-secondary" />
        <span className="text-[13px] font-medium text-ink">{t("browser.preview.notOpen")}</span>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("browser.preview.blank", { name: bot.name })}</p>
      </div>
    : preview.frame ? <PreviewImage frame={preview.frame} alt={caption} acknowledge={preview.acknowledge} /> : undefined;
  return <>
    <ComputerScreen
      source="browser"
      icon={Globe}
      state={screenState}
      caption={caption}
      message={message}
      actions={actions}
      live={live}
      bot={bot}
      computerName={t("computer.view.browser")}
      onOpen={screenState === "running" ? open : undefined}
      openAlwaysShown={waiting}
      controls={screenState === "off" ? { play: open } : undefined}
    />
    {takeover && <SandboxDesktopModal kind="browser" title={caption} state="running" onClose={() => { setTakeover(false); setTeach(false); setOpenSignIn(undefined); }}
      screen={(control) => <LiveBrowser key={bot.id} bot={bot} control={control} placeholder={lastFrame.current} teach={teach} signIn={openSignIn} />} />}
  </>;
}

/** What the browser tab says when it cannot show the browser, in the screen's frame. */
function BrowserNote({ caption, children }: { caption: string; children: ReactNode }) {
  return <figure className="m-0 flex flex-col gap-1.5">
    <div className="flex aspect-[16/10] min-h-fit w-full flex-col items-start justify-center gap-3 overflow-hidden rounded-2xl border border-hairline bg-card p-5">{children}</div>
    <figcaption className="truncate text-center text-[13px] text-ink-secondary" title={caption}>{caption}</figcaption>
  </figure>;
}

export function BrowserPanel({ bot, signIn }: { bot: Bot; signIn?: BrowserSignIn | undefined }) {
  const { state } = useStore();
  const engine = state.config?.browserEngine;
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => { let active = true; void api("/api/auth/session").then((session) => { if (active) setAdmin(session.scopes.includes("admin")); }).catch(() => { if (active) setAdmin(false); }); return () => { active = false; }; }, []);
  const installing = requested || engine?.installing === true;
  const install = async () => {
    setError(null); setRequested(true);
    try { await api("/api/browser-engine/install", { method: "POST" }); }
    catch (cause) { setError(readableError(cause)); }
    finally { setRequested(false); }
  };
  const caption = t("computer.browserOf", { name: bot.name });
  if (bot.browser === false) return <BrowserNote caption={caption}><p className="text-[13px] text-ink-secondary">{t("browser.panel.enable")}</p></BrowserNote>;
  // Watching and taking over a session the bot already opened is for anyone
  // who can use the bot. Installing the engine on this computer stays admin.
  if (engine?.kind === "engine" && !installing && !engine.installError) return <BrowserComputerScreen key={bot.id} bot={bot} signIn={signIn} />;
  return <BrowserNote caption={caption}>
    <div className="text-[15px] font-medium text-ink">{engine?.kind === "engine" ? t("browser.panel.incomplete") : t("browser.panel.notInstalled")}</div>
    <p className="text-[13px] leading-relaxed text-ink-secondary">{engine?.kind === "engine" ? t("browser.panel.incompleteHint") : <BrowserUnavailableNote config={state.config} />}</p>
    {engine?.installable || engine?.kind === "engine" ? <button type="button" onClick={() => void install()} disabled={installing || admin !== true} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">{installing ? t("browser.panel.installing") : engine?.kind === "engine" ? t("browser.panel.retryInstall") : t("browser.panel.install")}</button> : null}
    {(engine?.installError || error) && <p role="alert" className="text-[12px] text-danger">{error ?? engine?.installError}</p>}
  </BrowserNote>;
}
