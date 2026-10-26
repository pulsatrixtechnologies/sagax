// Settings > Experimental > My Chrome: off by default. When on, bots set to
// "My Chrome" work in the person's own Chrome, only on the sites listed here,
// with an approval card for payments, sends and deletes, and Stop ends it at
// once (server/browser/my-chrome/).
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { announceMyChrome, MY_CHROME_CHANGED, myChromeCall, tabOrigin, type MyChromeStatus } from "@/lib/my-chrome";
import { DescribedRow, Switch } from "../SettingsPrimitives";

export function MyChromeSettings() {
  const [status, setStatus] = useState<MyChromeStatus | null>(null);
  const [site, setSite] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    myChromeCall("status").then((next) => { if (live) { setStatus(next); setAddress(next.chromeAddress); } }, () => {});
    const onChange = (event: Event) => { const next = (event as CustomEvent<MyChromeStatus>).detail; if (next) setStatus(next); };
    window.addEventListener(MY_CHROME_CHANGED, onChange);
    return () => { live = false; window.removeEventListener(MY_CHROME_CHANGED, onChange); };
  }, []);

  const run = async (action: Parameters<typeof myChromeCall>[0], body: Record<string, unknown> = {}) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const next = await myChromeCall(action, body);
      setStatus(next);
      announceMyChrome(next);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.myChrome.error"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const inputClass = "min-w-0 flex-1 rounded-md border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-50";
  const buttonClass = "shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50";
  const driving = status.driving.filter((client) => client.tabs.length > 0 || client.botName);

  return (
    <div data-experimental-feature="myChrome" data-my-chrome="" data-unavailable={status.offered ? undefined : ""}>
      <DescribedRow
        label={t("settings.myChrome.title")}
        description={status.offered ? t("settings.myChrome.description") : t("settings.myChrome.unavailable")}
        rowId="myChrome"
        below={status.enabled && status.offered ? (
          <div className="mt-2 flex flex-col gap-3 border-l-[0.5px] border-border pl-3" data-my-chrome-panel="">
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("settings.myChrome.setup")}</p>
            <div className="flex flex-wrap items-center gap-2" data-my-chrome-state={status.stopped ? "stopped" : driving.length ? "driving" : "idle"}>
              <span className="min-w-0 flex-1 text-[12px] text-ink">
                {status.stopped ? t("settings.myChrome.stopped")
                  : driving.length ? driving.map((client) => t("settings.myChrome.driving", { bot: client.botName || t("myChrome.someBot"), sites: [...new Set(client.tabs.map((tab) => tabOrigin(tab.url)))].join(", ") || "-" })).join(" ")
                    : t("settings.myChrome.idle")}
              </span>
              {status.stopped
                ? <button type="button" className={buttonClass} disabled={busy} onClick={() => void run("resume")}>{t("settings.myChrome.resume")}</button>
                : <button type="button" className="shrink-0 rounded-md bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50" disabled={busy} onClick={() => void run("stop")} data-my-chrome-stop="">{t("settings.myChrome.stop")}</button>}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink">{t("settings.myChrome.sites")}</span>
              {status.sites.length === 0 && <p className="text-[12px] text-ink-secondary">{t("settings.myChrome.sitesEmpty")}</p>}
              <ul className="divide-y divide-hairline/30" data-my-chrome-sites="">
                {status.sites.map((entry) => (
                  <li key={entry.origin} className="flex min-w-0 items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.origin}</span>
                    <button type="button" className={buttonClass} disabled={busy} aria-label={t("settings.myChrome.revokeAria", { site: entry.origin })} onClick={() => void run("sites/revoke", { site: entry.origin })}>{t("settings.myChrome.revoke")}</button>
                  </li>
                ))}
              </ul>
              <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run("sites", { site }).then((ok) => { if (ok) setSite(""); }); }}>
                <label htmlFor="my-chrome-site" className="sr-only">{t("settings.myChrome.addLabel")}</label>
                <input id="my-chrome-site" value={site} onChange={(event) => setSite(event.target.value)} placeholder="https://example.com" maxLength={300} disabled={busy} className={inputClass} />
                <button type="submit" className={buttonClass} disabled={busy || !site.trim()}>{t("settings.myChrome.add")}</button>
              </form>
            </div>
            <details className="min-w-0">
              <summary className="cursor-pointer text-[12px] font-medium text-ink-secondary hover:text-ink">{t("settings.myChrome.address")}</summary>
              <form className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run("address", { address }); }}>
                <label htmlFor="my-chrome-address" className="sr-only">{t("settings.myChrome.address")}</label>
                <input id="my-chrome-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="9222" maxLength={300} disabled={busy} className={inputClass} />
                <button type="submit" className={buttonClass} disabled={busy}>{t("common.save")}</button>
              </form>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">{t("settings.myChrome.addressHint")}</p>
            </details>
            {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
          </div>
        ) : error ? <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p> : undefined}
      >
        <Switch
          checked={status.enabled}
          aria-label={t("settings.myChrome.aria")}
          disabled={busy || (!status.offered && !status.enabled)}
          onClick={() => void run("enable", { enabled: !status.enabled })}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        />
      </DescribedRow>
    </div>
  );
}
