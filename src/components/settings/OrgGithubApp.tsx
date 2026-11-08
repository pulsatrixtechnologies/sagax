// Settings > Organization > GitHub OAuth App (admins, 2026-10-28). An
// optional override since 2026-11-08: Sagax's built-in OAuth App
// (server/github/builtin-client.ts) already lets each person "Connect GitHub"
// with a link and a code on the GitHub plugin's page; the client id set here
// replaces it with the organization's own app. It is a server setting, so it
// is not in Connect apps. A client id is
// public; it saves through PATCH /api/org/settings { githubClientId }. Set
// on the server (SAGAX_GITHUB_CLIENT_ID), it is shown and not edited here.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { loadPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow } from "../SettingsPrimitives";

type Settings = PerspicaxOrg["settings"];

export function OrgGithubApp({ initial }: { initial: Settings }) {
  const github = initial.github ?? { clientId: null, fromEnvironment: false };
  const [clientId, setClientId] = useState(github.fromEnvironment ? "" : github.clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ githubClientId: clientId.trim() || null }) });
      void loadPerspicaxOrg(true);
      setStatus({ kind: "saved", text: t("organization.plugins.saved") });
    } catch (failure) {
      setStatus({ kind: "error", text: readableError(failure) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-settings-card="organization.githubApp" data-org-github-app>
      <DescribedRow
        label={t("organization.github.clientId")}
        rowId="githubApp"
        description={github.fromEnvironment ? t("organization.github.fromEnvironment") : t("organization.github.hint")}
        below={(
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={github.fromEnvironment}
                placeholder={github.fromEnvironment && github.clientId ? github.clientId : "Ov23li..."}
                aria-label={t("organization.github.clientId")}
                className="min-w-0 flex-[1_1_240px] rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent disabled:opacity-60" />
              {!github.fromEnvironment && (
                <button type="button" className="ui-button" disabled={busy} onClick={() => void save()}>{t("organization.plugins.save")}</button>
              )}
            </div>
            {status && (
              <p role={status.kind === "saved" ? "status" : "alert"} className={status.kind === "saved" ? "text-[12px] text-ink-secondary" : "text-[12px] text-danger"}>{status.text}</p>
            )}
          </div>
        )}
      />
    </div>
  );
}
