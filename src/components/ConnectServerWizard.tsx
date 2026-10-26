// Settings > Organization: one "Connect to a server" card (2026-10-14). It
// replaces three forms that each connected this app somewhere else: Join a
// Perspicax server, Connect to a server (a link or address, in Your servers)
// and Connect to another computer. The person picks what they connect to,
// then gets that form; each form is the one that was there before, so
// joining, pairing and switching work exactly as they did.
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { Card } from "./SettingsPrimitives";
import { JoinPerspicaxCard } from "./JoinPerspicaxCard";
import { RemoteComputerSection } from "./RemoteComputerSection";

export type ConnectTarget = "perspicax" | "server" | "computer";

const LABEL: Record<ConnectTarget, { title: LocaleKey; hint: LocaleKey }> = {
  perspicax: { title: "settings.connectWizard.perspicax", hint: "settings.connectWizard.perspicaxHint" },
  server: { title: "settings.connectWizard.server", hint: "settings.connectWizard.serverHint" },
  computer: { title: "settings.connectWizard.computer", hint: "settings.connectWizard.computerHint" },
};

/** What this window can connect to: a Perspicax organization always (in a
 * browser, by downloading the copy of the bots), a Sagax server by link where
 * the desktop keeps a server list, another computer where the desktop can be
 * its client. A desktop that is already a client of another computer is not
 * offered a second one: its card shows that connection and Disconnect. */
export function connectTargets(input: { environments: boolean; remoteClient: boolean; remoteActive: boolean; computerPairing?: boolean }): ConnectTarget[] {
  return [
    ...(!input.remoteActive ? ["perspicax" as const] : []),
    ...(input.environments ? ["server" as const] : []),
    // "Another computer" needs a code from that computer's Pair devices,
    // hidden since 2026-10-14 (devices sign in with the organization):
    // offered no more. RemoteComputerSection still shows and ends an
    // existing connection.
    ...(input.remoteClient && !input.remoteActive && input.computerPairing === true ? ["computer" as const] : []),
  ];
}

const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50";

/** A Sagax server by its address or a pairing link: the form that was
 * Your servers > Connect to a server. A successful connect reloads this
 * window on that server. */
function ServerLinkForm() {
  const bridge = window.ogb?.environments;
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (!bridge) return null;
  const connect = async () => {
    if (pending.current || !address.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await bridge.addFromLink(address.trim(), name.trim());
    } catch (cause) {
      setError(String((cause as Error)?.message ?? cause).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
      <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{t("settings.servers.address")}
        <input required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
          placeholder="https://bots.yourcompany.com" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
          className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{t("settings.servers.name")}
        <input value={name} disabled={busy} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("settings.servers.namePlaceholder")}
          className={inputClass} />
      </label>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("settings.servers.paste")}</p>
      <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">{t("settings.servers.needCode")}</summary>
        <p className="mt-2">{t("settings.servers.run")}</p>
        <code className="mt-1 block select-all break-words rounded-md bg-inset px-2 py-2 text-ink">npx @pulsatrixtechnologies/sagax pair --label "My desktop"</code>
      </details>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <button type="submit" disabled={busy || !address.trim()} className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">
        {busy && <Loader2 size={14} className="animate-spin" />}{t("settings.servers.connect")}
      </button>
    </form>
  );
}

export function ConnectServerWizard({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const targets = connectTargets({
    environments: Boolean(window.ogb?.environments),
    remoteClient: Boolean(window.ogb?.remoteClient),
    remoteActive: window.ogb?.remoteClient?.active === true,
  });
  const [chosen, setChosen] = useState<ConnectTarget>(targets[0] ?? "perspicax");
  if (targets.length === 0) return null;
  const target = targets.includes(chosen) ? chosen : targets[0]!;
  return (
    <Card
      collapsible
      cardId="organization.connect"
      defaultOpen={defaultOpen}
      title={t("settings.connectWizard.title")}
      subtitle={t("settings.connectWizard.subtitle")}
      summary={t(LABEL[target].title)}
    >
      <div className="flex flex-col gap-4" data-connect-wizard={target}>
        {targets.length > 1 && (
          <div role="radiogroup" aria-label={t("settings.connectWizard.type")} className="flex flex-col gap-1.5">
            {targets.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={target === option}
                data-connect-target={option}
                onClick={() => setChosen(option)}
                className={cn(
                  "flex flex-col rounded-lg border px-3 py-2 text-left transition-colors",
                  target === option ? "border-accent/50 bg-accent/10" : "border-hairline/40 hover:bg-hover",
                )}
              >
                <span className="text-[13px] text-ink">{t(LABEL[option].title)}</span>
                <span className="text-[12px] leading-relaxed text-ink-secondary">{t(LABEL[option].hint)}</span>
              </button>
            ))}
          </div>
        )}
        {target === "perspicax" && <JoinPerspicaxCard embedded />}
        {target === "server" && <ServerLinkForm />}
        {target === "computer" && <RemoteComputerSection embedded />}
      </div>
    </Card>
  );
}
