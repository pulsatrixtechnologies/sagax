import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";

/** Consistent with `serverAddressOk` in server/org/org-record.ts: https for any
 * host, http only for a Tailscale name or a local Docker server. */
export function orgHostFromInput(value: string): { kind: "server"; url: string } | null {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    const localOrTailnet = parsed.hostname.endsWith(".ts.net") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && localOrTailnet)) return { kind: "server", url };
  } catch { /* not a URL */ }
  return null;
}

/** Everyone in the organization signs in to this server; ask for its address
 * up front rather than defaulting to a computer that may go offline. */
export function OrgCreateForm({
  initialAddress,
  onCreate,
}: {
  initialAddress: string;
  onCreate: (name: string, host: { kind: "server"; url: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(initialAddress);
  const host = orgHostFromInput(address);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const value = name.trim();
        if (value && host) void onCreate(value, host);
      }}
    >
      <label className="flex flex-col gap-1.5 text-[13px] text-ink">
        {t("org.name")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-ink">
        {t("org.serverAddress")}
        <input
          name="org-server-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="https://…"
          autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50"
        />
        <span className="text-[12px] text-ink-secondary">{t("org.serverAddressHelp")}</span>
      </label>
      <button type="submit" disabled={!host} className="w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
        {t("org.create")}
      </button>
    </form>
  );
}
