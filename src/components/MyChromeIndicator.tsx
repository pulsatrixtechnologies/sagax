// While a bot drives the person's own Chrome (My Chrome), a banner across the
// top of Sagax says which bot and on which site, with a Stop button: one click
// ends every bot's driving at once (POST /api/my-chrome/stop). The same Stop
// sits in the driven tab itself (server/browser/my-chrome/gate.ts).
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { announceMyChrome, MY_CHROME_CHANGED, myChromeCall, tabOrigin, type MyChromeStatus } from "@/lib/my-chrome";

const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

/** The bots driving now, each with the sites of its tabs. */
export function drivingSummary(status: MyChromeStatus | null): Array<{ bot: string; sites: string }> {
  if (!status || !status.enabled || status.stopped) return [];
  return status.driving.map((client) => ({
    bot: client.botName,
    sites: [...new Set(client.tabs.map((tab) => tabOrigin(tab.url)).filter((origin) => origin && origin !== "about:blank"))].join(", "),
  }));
}

export function MyChromeIndicator() {
  const [status, setStatus] = useState<MyChromeStatus | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next: MyChromeStatus | null = null;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        try { next = await myChromeCall("status"); } catch { next = null; }
        if (live) setStatus(next);
      }
      if (!live) return;
      // Not offered here, or not this viewer's to see (a phone, a member): no more polling.
      if (next === null || !next.offered) { if (document.visibilityState !== "hidden") return; }
      const active = Boolean(next?.enabled && next.offered);
      timer = setTimeout(() => void poll(), active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<MyChromeStatus>).detail;
      if (!next) return;
      setStatus(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), ACTIVE_POLL_MS);
    };
    window.addEventListener(MY_CHROME_CHANGED, onChange);
    void poll();
    return () => { live = false; if (timer) clearTimeout(timer); window.removeEventListener(MY_CHROME_CHANGED, onChange); };
  }, []);

  const driving = drivingSummary(status);
  if (!driving.length) return null;
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const next = await myChromeCall("stop");
      setStatus(next);
      announceMyChrome(next);
    } catch { /* the next poll shows the state */ }
    finally { setStopping(false); }
  };
  return (
    <div role="status" data-my-chrome-indicator="" className="flex shrink-0 items-center justify-center gap-3 bg-danger px-3 py-1.5 text-[12px] font-medium text-white">
      <span className="min-w-0 truncate">
        {driving.map((entry) => t(entry.bot ? "myChrome.indicator" : "myChrome.indicatorSomeBot", { bot: entry.bot, sites: entry.sites || "-" })).join(" · ")}
      </span>
      <button
        type="button"
        onClick={() => void stop()}
        disabled={stopping}
        aria-label={t("myChrome.stopAria")}
        className="shrink-0 rounded-full bg-white px-3 py-0.5 text-[12px] font-semibold text-danger hover:opacity-90 disabled:opacity-60"
      >
        {t("myChrome.stop")}
      </button>
    </div>
  );
}
