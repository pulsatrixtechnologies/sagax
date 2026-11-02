import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot as BotIcon, EllipsisVertical, Globe, Hand, Loader2, Plus, RotateCw, Square, UserRound, X } from "lucide-react";
import { BrowserUnavailableNote } from "./SettingsLink";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot } from "@/state/store";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { BrowserViewport, type BrowserFrame } from "./BrowserViewport";
import { createBrowserInputQueue } from "@/lib/browser-input-queue";
import { createBrowserControl, type BrowserInteraction, type BrowserTakeStatus } from "@/lib/browser-control";
import { resolveAddressBarInput } from "@/lib/browser-address";
import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { browserDot, reportScreenDot } from "@/lib/screen-status";
import { ComputerScreen, type ScreenAction } from "./computer/ComputerScreen";
import { SandboxDesktopModal } from "./computer/SandboxDesktopModal";
import { NetworkDebuggerDialog } from "./NetworkDebuggerDialog";
import { TeachStepsDialog } from "./TeachStepsDialog";
import { onBrowserTeachRequest, takeBrowserTeach } from "@/lib/teach-request";
import type { TeachStep } from "../../shared/teach-recording";
import { readableError } from "@/lib/plain-error";

interface BrowserTab { tabId: string; title: string; url: string; active: boolean }
type ViewerFrame = BrowserFrame & { viewerId: string; generation: number };
const button = "rounded-md p-1.5 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";
const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000];

const NO_CONTROL = { held: false, controlling: false, owned: false };
/** Where the window takes a browser that shows a blank page (the server
 * launches a closed one there too: BROWSER_START_URL in server/browser-live.ts). */
export const BROWSER_START_URL = "https://www.google.com/";

/** Closing a panel releases its lease. A new connection never silently
 * restores permission to type, and never replays old browser frames.
 * Interacting takes the browser from the bot, and a few idle seconds hand it
 * back (see createBrowserControl). The bar under the address says who has
 * the browser, with Take control (kept until handed back) and Give back.
 * `control`: false hands the browser back at once and leaves the page
 * view-only. `placeholder`: the preview's last picture, shown dimmed while
 * the live view connects, so the window never opens on an empty square. */
export function LiveBrowser({ bot, control: allowed = true, placeholder, teach = false }: { bot: Bot; control?: boolean; placeholder?: string | undefined; teach?: boolean }) {
  const { state } = useStore();
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
  // Teach by demonstration (server/browser-teach.ts): a recording runs, then
  // its steps open in the editor. Never null: the test fixture gives every
  // useState(null) the frame.
  const [recording, setRecording] = useState(false);
  const [taught, setTaught] = useState<{ steps: TeachStep[]; recordedAt: string } | undefined>(undefined);
  const [teachNote, setTeachNote] = useState("");
  const viewer = useRef("");
  const generation = useRef(0);
  const pendingOperation = useRef<number | null>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const profilesDialog = useRef<HTMLDialogElement>(null);
  const typingDialog = useRef<HTMLDialogElement>(null);
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
  const profileName = bot.browserProfile === "guest" ? t("browser.profile.temporary")
    : bot.browserProfile === "my-chrome" ? t("settings.profiles.myChrome")
    : state.config?.browserProfiles?.find((profile) => profile.id === bot.browserProfile)?.name ?? t("browser.profile.own", { name: bot.name });
  useEffect(() => { if (showProfiles) profilesDialog.current?.showModal(); else profilesDialog.current?.close(); }, [showProfiles]);
  useEffect(() => {
    // Typed text goes to the field the person picked, so keep control while they write it.
    browserControl.current?.hold(showTyping);
    if (showTyping) typingDialog.current?.showModal(); else typingDialog.current?.close();
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
    urlEditing.current = false; startChecked.current = false;
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
      // The person opened the window on a browser with nothing in it: start
      // where a browser starts, not on a white page. Never moves a real page.
      if (!startChecked.current && active) {
        startChecked.current = true;
        if (allowedNow.current && isBlankPage(active.url)) browserControl.current?.interact({ command: { type: "navigate", url: BROWSER_START_URL } });
      }
    });
    listen("url", (data) => { if (typeof data.url === "string" && !urlEditing.current) setAddress(data.url === "about:blank" ? "" : data.url); });
    listen("status", (data) => {
      if (data.viewportWidth > 0 && data.viewportHeight > 0) setViewport({ width: data.viewportWidth, height: data.viewportHeight });
    });
    listen("control", (data) => {
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
  // Usable whenever connected and no other window holds the browser: the
  // first real interaction takes control from the bot by itself.
  const heldElsewhere = control.held && !control.owned;
  const interactive = allowed && connected && !heldElsewhere && !pending;
  // The dialog pins a lease; it cannot acquire one or freeze the field the
  // person picked. Click that page field first, before writing in the dialog.
  const typingReady = interactive && control.owned && control.controlling;
  // Toolbar actions wait out a take as they wait out a running action, so a
  // repeated click cannot pile up behind it. Page input still buffers.
  const taking = takeStatus === "pending" || takeStatus === "slow";
  const commandsReady = interactive && !taking;
  const pill = "flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border bg-menu px-2.5 py-1 text-[11px] shadow-sm sm:text-[12px]";
  // Who has the browser, in words, with the one action that changes it.
  const mine = control.owned && control.controlling;
  const pageTitle = tabs.find((tab) => tab.active)?.title ?? "";
  const holder = mine ? t("sandboxDesktop.controlling") : heldElsewhere ? t("browser.live.heldElsewhere")
    : taking ? t("browser.control.waiting", { name: bot.name }) : t("browser.control.bot", { name: bot.name });
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-card text-ink">
    <div className="flex min-h-12 items-center gap-1 px-2 pt-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.length ? tabs.map((tab) => <div key={tab.tabId} className={`flex max-w-52 shrink-0 items-center gap-1 rounded-xl px-1 text-[12px] ${tab.active ? "bg-inset text-ink" : "text-ink-secondary"}`}>
          <Globe size={13} className="ml-1.5 shrink-0 opacity-60" />
          <button className="truncate px-1 py-2 text-left disabled:cursor-default" disabled={!commandsReady} onClick={() => command({ type: "tab-select", tabId: tab.tabId })} title={tab.title || tab.url}>{tab.title || t("browser.tab.new")}</button>
          <button className={button} aria-label={tab.title ? t("browser.tab.close", { title: tab.title }) : t("browser.tab.closeUntitled")} disabled={!commandsReady} onClick={() => command({ type: "tab-close", tabId: tab.tabId })}><X size={13} /></button>
        </div>) : <div className="flex items-center gap-2 rounded-xl bg-inset px-3 py-2 text-[12px] text-ink-secondary"><Globe size={13} />{t("browser.tab.new")}</div>}
        <button className={`${button} shrink-0`} disabled={!commandsReady} aria-label={t("browser.tab.new")} title={t("browser.tab.new")} onClick={() => command({ type: "tab-new" })}><Plus size={17} /></button>
      </div>
      {/* Profiles can't switch while this window holds the browser: opening them hands it back now, not after the idle wait. */}
      <button className={`${button} rounded-xl bg-inset p-2`} title={t("browser.profile.current", { name: profileName })} aria-label={t("browser.profiles.open")} aria-expanded={showProfiles} onClick={() => { browserControl.current?.handBack(); setShowProfiles(true); }}><UserRound size={16} /></button>
    </div>
    <form className="flex h-12 items-center gap-1 border-b border-hairline/40 px-2" onSubmit={(e) => { e.preventDefault(); const url = resolveAddressBarInput(address); if (commandsReady && url) command({ type: "navigate", url }); else if (address.trim()) setError(t("browser.address.invalid")); }}>
      <div className="flex shrink-0 items-center">
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.back")} onClick={() => command({ type: "back" })}><ArrowLeft size={17} /></button>
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.forward")} onClick={() => command({ type: "forward" })}><ArrowRight size={17} /></button>
        <button type="button" className={button} disabled={!commandsReady} aria-label={t("browser.nav.reload")} onClick={() => command({ type: "reload" })}><RotateCw size={17} /></button>
      </div>
      <input ref={addressInput} aria-label={t("browser.address.label")} readOnly={!commandsReady} value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => { urlEditing.current = true; if (commandsReady) e.target.select(); }} onBlur={() => { urlEditing.current = false; }} placeholder={connected ? "about:blank" : t("browser.live.connecting")} spellCheck={false} className="mx-1 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-center text-[12px] outline-none placeholder:text-ink-secondary focus:bg-inset focus:text-left" />
      <details className="relative shrink-0">
        <summary className={`${button} list-none cursor-pointer [&::-webkit-details-marker]:hidden`} aria-label={t("browser.menu.label")} title={t("browser.menu.label")}><EllipsisVertical size={17} /></summary>
        <div className="absolute right-0 top-full z-20 mt-2 flex w-44 flex-col rounded-xl border border-hairline/50 bg-card p-1.5 text-[12px] shadow-xl">
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!typingReady} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setShowTyping(true); }}>{t("browser.menu.type")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!connected} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setShowNetwork(true); }}>{t("browser.menu.network")}</button>
          <button type="button" data-teach-record="" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!recording && !commandsReady} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            void (recording ? stopRecording() : startRecording());
          }}>{recording ? t("teach.stop") : t("teach.start")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset" onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); reconnect(); }}>{t("browser.menu.reconnect")}</button>
          <button type="button" className="rounded-md px-3 py-2 text-left hover:bg-inset disabled:opacity-40" disabled={!connected || pending || taking} onClick={(e) => {
            e.currentTarget.closest("details")?.removeAttribute("open");
            if (!window.confirm(t("browser.menu.restartConfirm"))) return;
            void execute({ type: "restart" });
          }}>{t("browser.menu.restart")}</button>
        </div>
      </details>
    </form>
    {/* While a recording runs this bar stays at the top of the window, above
        the page, with the one action that ends it. */}
    {recording && <div role="status" data-teach-recording="" className="flex min-h-10 items-center gap-2 border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[12px] text-danger">
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" /></span>
      <span className="min-w-0 flex-1 font-medium">{t("teach.recording")}</span>
      <button type="button" data-teach-stop="" onClick={() => void stopRecording()}
        className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-danger px-3 py-1 font-medium text-danger-ink hover:brightness-110 md:min-h-0">
        <Square size={11} fill="currentColor" aria-hidden="true" />{t("teach.stop")}
      </button>
    </div>}
    {teachNote && !recording && <div role="status" className="border-b border-hairline/30 px-3 py-2 text-[12px] text-ink-secondary">{teachNote}</div>}
    <div data-browser-holder={mine ? "you" : heldElsewhere ? "elsewhere" : "bot"} className="flex min-h-10 items-center gap-2 border-b border-hairline/40 px-3 py-1.5 text-[12px]">
      <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", mine ? "font-medium text-accent-text" : "text-ink-secondary")}>
        {mine ? <Hand size={13} className="shrink-0" aria-hidden="true" /> : <BotIcon size={13} className="shrink-0" aria-hidden="true" />}
        <span className="shrink-0">{holder}</span>
        {pageTitle && <span className="min-w-0 truncate font-normal text-ink-secondary" title={pageTitle}>· {pageTitle}</span>}
      </span>
      {allowed && connected && !heldElsewhere && (mine
        ? <button type="button" data-browser-give-back="" onClick={() => browserControl.current?.handBack()}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-control px-3 py-1 font-medium text-ink hover:bg-raised-hover md:min-h-0">
            <BotIcon size={12} aria-hidden="true" />{t("browser.control.giveBack")}
          </button>
        : <button type="button" data-browser-take="" disabled={taking || pending} onClick={() => browserControl.current?.takeNow()}
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-medium text-accent-ink hover:brightness-110 disabled:opacity-50 md:min-h-0">
            <Hand size={12} aria-hidden="true" />{t("sandboxDesktop.takeControl")}
          </button>)}
    </div>
    {error && <div role={reconnecting ? "status" : "alert"} className={`flex items-center justify-between gap-2 border-b border-hairline/30 px-3 py-2 text-[12px] ${reconnecting ? "text-ink-secondary" : "text-danger"}`}><span>{error}</span>{!connected && <button className="shrink-0 underline" onClick={reconnect}>{t("browser.live.reconnect")}</button>}</div>}
    <div className={cn("relative min-h-0 flex-1 overflow-hidden bg-inset/40", recording && "ring-2 ring-inset ring-danger")}>
      {frame ? <BrowserViewport frame={frame} {...viewport} driving={interactive} input={input}
        onReturnToToolbar={() => addressInput.current?.focus()}
        acknowledge={(seq) => { if (generation.current === frame.generation && viewer.current === frame.viewerId) void action({ type: "ack", seq }, frame.viewerId).catch(() => {}); }}
        onDecodeError={() => { if (generation.current === frame.generation && viewer.current === frame.viewerId) setError(t("browser.frame.decodeError")); }} />
        : placeholder && !heldElsewhere && !(error && !reconnecting)
          ? <div data-browser-placeholder="" className="absolute inset-0">
            <img src={placeholder} alt="" draggable={false} className="h-full w-full select-none object-contain opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`${pill} border-hairline text-ink`}><Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />{busy ? t("browser.live.botBusy", { name: bot.name }) : t("browser.live.connecting")}</span>
            </div>
          </div>
        : <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-secondary">{connected && heldElsewhere ? <Hand size={24} /> : error && !reconnecting ? <Globe size={24} /> : <Loader2 size={24} className="animate-spin" />}<span>{heldElsewhere ? t("browser.live.heldElsewhere") : reconnecting ? t("browser.live.reconnectingShort") : error ? t("browser.live.disconnected") : busy ? t("browser.live.botBusy", { name: bot.name }) : t("browser.live.opening")}</span></div>}
      {/* Status only, never a control: it floats over the top of the page,
          readable at any panel width, and every click passes through it. */}
      <div role="status" className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-3">
        {takeStatus === "slow" ? <span className={`${pill} border-hairline text-ink-secondary`}>
          <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" /><span className="truncate">{t("browser.control.waiting", { name: bot.name })}</span>
        </span> : takeStatus === "stale" ? <span className={`${pill} border-accent-border text-accent-text`}>
          <Hand size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{t("browser.control.stale", { name: bot.name })}</span>
        </span> : null}
      </div>
    </div>
    <dialog ref={profilesDialog} onClose={() => setShowProfiles(false)} onClick={(e) => { if (e.target === e.currentTarget) setShowProfiles(false); }} className="m-auto w-[min(420px,calc(100%-32px))] max-h-[80vh] overflow-auto rounded-2xl border border-hairline/50 bg-card p-5 text-ink shadow-2xl backdrop:bg-black/40">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-[15px] font-medium">{t("browser.profiles.open")}</h2><button className={button} aria-label={t("browser.profiles.close")} onClick={() => setShowProfiles(false)}><X size={16} /></button></div>
      {/* Opening this hands an idle hold back at once; say why the switcher waits otherwise. */}
      {(heldElsewhere || (control.owned && (pending || taking))) && <p className="mb-3 text-[12px] text-ink-secondary">{t(heldElsewhere ? "browser.profiles.heldElsewhere" : "browser.profiles.busy")}</p>}
      <BrowserProfilesManager bot={bot} disabled={pending || control.held} onProfileChanged={() => { setShowProfiles(false); reconnect(); }} />
    </dialog>
    {showNetwork && <NetworkDebuggerDialog botId={bot.id} botName={bot.name} onClose={() => setShowNetwork(false)} />}
    {taught && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={taught.steps} recordedAt={taught.recordedAt} onClose={() => setTaught(undefined)} />}
    <dialog ref={typingDialog} onClose={() => setShowTyping(false)} className="m-auto w-[min(420px,calc(100%-32px))] rounded-2xl border border-hairline/50 bg-card p-5 text-ink shadow-2xl backdrop:bg-black/40">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-medium">{t("browser.typing.title")}</h2><button className={button} aria-label={t("browser.typing.close")} onClick={() => setShowTyping(false)}><X size={16} /></button></div>
      <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault(); const field = e.currentTarget.elements.namedItem("pageText") as HTMLInputElement;
      if (typingReady && field.value) { input({ type: "input_keyboard", eventType: "char", text: field.value }); field.value = ""; setShowTyping(false); }
    }}><input name="pageText" aria-label={t("browser.typing.field")} autoComplete="off" maxLength={4096} placeholder={t("browser.typing.placeholder")} className="rounded-lg bg-inset px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-accent" /><button disabled={!typingReady} className="self-end rounded-lg bg-accent px-4 py-2 text-[12px] text-accent-ink disabled:opacity-40">{t("browser.typing.send")}</button></form>
    </dialog>
  </div>;
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

/** The bot's browser on the Computer tab, drawn as the VM's screen: a live
 * preview in the same frame, and Take control opens the same window as the
 * server environment's (SandboxDesktopModal), where LiveBrowser connects.
 * While that window is open the square shows no second stream. */
export function BrowserComputerScreen({ bot }: { bot: Bot }) {
  const [takeover, setTakeover] = useState(() => takeBrowserTeach(bot.id));
  // Opened from the composer's Teach a task: the window starts recording.
  const [teach, setTeach] = useState(takeover);
  useEffect(() => onBrowserTeachRequest((botId) => {
    if (botId !== bot.id || !takeBrowserTeach(bot.id)) return;
    setTeach(true); setTakeover(true);
  }), [bot.id]);
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
    {takeover && <SandboxDesktopModal kind="browser" title={caption} state="running" onClose={() => { setTakeover(false); setTeach(false); }}
      screen={(control) => <LiveBrowser key={bot.id} bot={bot} control={control} placeholder={lastFrame.current} teach={teach} />} />}
  </>;
}

/** What the browser tab says when it cannot show the browser, in the screen's frame. */
function BrowserNote({ caption, children }: { caption: string; children: ReactNode }) {
  return <figure className="m-0 flex flex-col gap-1.5">
    <div className="flex aspect-[16/10] min-h-fit w-full flex-col items-start justify-center gap-3 overflow-hidden rounded-2xl border border-hairline bg-card p-5">{children}</div>
    <figcaption className="truncate text-center text-[13px] text-ink-secondary" title={caption}>{caption}</figcaption>
  </figure>;
}

export function BrowserPanel({ bot }: { bot: Bot }) {
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
  if (engine?.kind === "engine" && !installing && !engine.installError) return <BrowserComputerScreen key={bot.id} bot={bot} />;
  return <BrowserNote caption={caption}>
    <div className="text-[15px] font-medium text-ink">{engine?.kind === "engine" ? t("browser.panel.incomplete") : t("browser.panel.notInstalled")}</div>
    <p className="text-[13px] leading-relaxed text-ink-secondary">{engine?.kind === "engine" ? t("browser.panel.incompleteHint") : <BrowserUnavailableNote config={state.config} />}</p>
    {engine?.installable || engine?.kind === "engine" ? <button type="button" onClick={() => void install()} disabled={installing || admin !== true} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">{installing ? t("browser.panel.installing") : engine?.kind === "engine" ? t("browser.panel.retryInstall") : t("browser.panel.install")}</button> : null}
    {(engine?.installError || error) && <p role="alert" className="text-[12px] text-danger">{error ?? engine?.installError}</p>}
  </BrowserNote>;
}
