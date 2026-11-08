// the GitHub plugin's page in Connect apps (2026-10-28, owner: "one GitHub
// connection, the one in Connect apps"). The person's GitHub account is the
// one GitHub source of every use: private marketplaces, gh and git in their
// bots, and the GitHub plugin's MCP server (its token placeholder is that
// account, server/github/github-mcp-token.ts). Sources lists marketplaces only.
//
//   - Connection: Connect GitHub (always GitHub's link and a code; a token
//     only under Advanced), the account connected and what it is
//     for. Organization server only (`connection`).
//   - Other credentials, only where the account cannot reach: another
//     GitHub organization, a group of repositories, another git host. The
//     person's own (add, rename, replace, remove with no admin) and the
//     organization's, marked "Organization", which an organization admin
//     changes (server/routes/github-credentials.ts). A marketplace row in
//     Sources picks one of them in a small selector; by default it reads
//     with the GitHub account.
//
// Connect GitHub is every person's, with no admin step (owner, 2026-10-28):
// always the device flow (built-in OAuth App, owner 2026-11-08), a token only
// under Advanced.
// It is shown on the GitHub plugin's page (PluginsPanel, `openGithub`), not
// in Providers (owner, 2026-10-29).
import { useState, type ReactNode } from "react";
import { ChevronRight, GitBranch } from "lucide-react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { changeGithubCredential, useGithubCredentials, type GithubCredentialPublic } from "@/lib/github-credentials";
import { MAX_ORG_GITHUB_TOKENS, ORG_GITHUB_TOKEN_HINT_SAVED } from "../../../shared/org-github-tokens";
import { MAX_PERSON_GITHUB_CREDENTIALS } from "../../../shared/github-credentials";

const fieldClass = "w-full min-w-0 rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

function hintText(hint: string): string {
  return hint === ORG_GITHUB_TOKEN_HINT_SAVED ? t("organization.githubTokens.savedHint") : `•••• ${hint}`;
}

export function GithubAccountSection({ connection }: {
  /** the person's GitHub connection (MyGithubConnection), organization server */
  connection?: ReactNode;
}) {
  // #2109: Connect GitHub (link plus pairing code) leads; the tokens for
  // other organizations or hosts are the last resort, under Advanced. A
  // server without the person's connection has only the tokens: open.
  const [advanced, setAdvanced] = useState(!connection);
  return (
    <section className="rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4 sm:px-5" data-accounts-github>
      <div className="mb-1 flex items-center gap-2">
        <GitBranch size={16} aria-hidden="true" className="text-ink" />
        <h3 className="text-[13px] font-semibold text-ink">{t("myConnections.github.title")}</h3>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-ink-secondary">{t("sources.github.intro")}</p>
      {connection && (
        <div className="mb-5 flex flex-col gap-1.5" data-github-connection>
          <span className="text-[12.5px] font-medium text-ink">{t("sources.github.connection")}</span>
          {connection}
        </div>
      )}
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-ink-secondary hover:text-ink"
        aria-expanded={advanced}
        data-github-credentials-advanced
        onClick={() => setAdvanced((open) => !open)}
      >
        <ChevronRight aria-hidden="true" size={12} className={advanced ? "rotate-90 transition-transform" : "transition-transform"} />
        {t("sources.github.advanced")}
      </button>
      {advanced && <div className="mt-3"><GithubCredentialList /></div>}
    </section>
  );
}

function GithubCredentialList() {
  const { view, error: loadError } = useGithubCredentials();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addSecret, setAddSecret] = useState("");
  const [addScope, setAddScope] = useState<"mine" | "org">("mine");
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "replace" | "remove" } | null>(null);
  const [draft, setDraft] = useState("");

  const run = async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(readableError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setEditing(null); setDraft(""); };
  const replaceLabel = t("organization.githubTokens.replace");

  if (!view) {
    return loadError
      ? <p role="alert" className="text-[12px] text-danger">{loadError}</p>
      : <p className="text-[12px] text-ink-secondary">{t("myConnections.loading")}</p>;
  }
  const mayChange = (entry: GithubCredentialPublic) => (entry.owner === "org" ? view.canManageOrg : true);
  const mine = view.credentials.filter((entry) => entry.owner === "mine").length;
  const org = view.credentials.filter((entry) => entry.owner === "org").length;
  const full = addScope === "org" ? org >= MAX_ORG_GITHUB_TOKENS : mine >= MAX_PERSON_GITHUB_CREDENTIALS;

  return (
    <div className="flex flex-col gap-2" data-github-credentials={view.credentials.length ? "list" : "empty"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">{t("sources.github.credentials")}</span>
        {!adding && (
          <button type="button" className="ui-button" disabled={busy} data-github-credential-add-open onClick={() => { close(); setAdding(true); setAddScope("mine"); }}>
            {t("sources.github.add")}
          </button>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("sources.github.credentialsHint")}</p>
      {view.credentials.length === 0 && !adding && (
        <p className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary" data-github-credentials-empty>{t("sources.github.empty")}</p>
      )}
      {view.credentials.length > 0 && (
        <ul className="flex flex-col divide-y divide-hairline/60 rounded-xl border border-border">
          {view.credentials.map((entry) => {
            const open = editing?.id === entry.id ? editing.mode : null;
            return (
              <li key={entry.id} className="flex flex-col gap-2 px-3 py-2.5" data-github-credential={entry.id} data-github-credential-owner={entry.owner}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.label}</span>
                  {entry.owner === "org" && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent" data-github-credential-org>{t("sources.github.orgBadge")}</span>}
                  {entry.onlyWhereChosen && <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary" title={t("sources.github.onlyWhereChosenHint")}>{t("sources.github.onlyWhereChosen")}</span>}
                  <span className="shrink-0 font-mono text-[11px] text-ink-secondary" data-github-credential-hint>{hintText(entry.hint)}</span>
                </div>
                <div className="text-[11.5px] text-ink-secondary">
                  {entry.chosenBy > 0 ? t("sources.github.chosenBy", { count: entry.chosenBy }) : entry.onlyWhereChosen ? t("sources.github.chosenByNone") : t("sources.github.automatic")}
                </div>
                {mayChange(entry) && open === null && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ui-button" disabled={busy} onClick={() => { setAdding(false); setEditing({ id: entry.id, mode: "rename" }); setDraft(entry.label); }}>{t("sources.github.rename")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={() => { setAdding(false); setEditing({ id: entry.id, mode: "replace" }); setDraft(""); }}>{replaceLabel}</button>
                    <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => { setAdding(false); setEditing({ id: entry.id, mode: "remove" }); }}>{t("organization.githubTokens.remove")}</button>
                  </div>
                )}
                {open === "rename" && (
                  <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => changeGithubCredential({ op: "rename", id: entry.id, label: draft.trim() })).then((ok) => { if (ok) close(); }); }}>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={80} aria-label={t("organization.githubTokens.label")} className={`${fieldClass} flex-[1_1_200px]`} />
                    <button type="submit" className="ui-button" disabled={busy || !draft.trim()}>{t("organization.githubTokens.saveLabel")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={close}>{t("organization.githubTokens.cancel")}</button>
                  </form>
                )}
                {open === "replace" && (
                  <form className="flex flex-wrap gap-2" data-github-credential-replace={entry.id} onSubmit={(event) => {
                    event.preventDefault();
                    const token = draft.trim();
                    setDraft("");
                    void run(() => changeGithubCredential({ op: "replace", id: entry.id, token })).then((ok) => { if (ok) close(); });
                  }}>
                    <input type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t("organization.githubTokens.secret")} className={`${fieldClass} flex-[1_1_200px] font-mono`} />
                    <button type="submit" className="ui-button" disabled={busy || draft.trim().length < 8}>{t("organization.githubTokens.saveSecret")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={close}>{t("organization.githubTokens.cancel")}</button>
                  </form>
                )}
                {open === "remove" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-ink-secondary">{entry.chosenBy > 0 ? t("sources.github.confirmRemoveUsed", { count: entry.chosenBy }) : t("organization.githubTokens.confirmRemove")}</span>
                    <button type="button" className="ui-button text-danger" disabled={busy} onClick={() => void run(() => changeGithubCredential({ op: "remove", id: entry.id })).then((ok) => { if (ok) close(); })}>{t("organization.githubTokens.remove")}</button>
                    <button type="button" className="ui-button" disabled={busy} onClick={close}>{t("organization.githubTokens.cancel")}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <form className="flex flex-col gap-2 rounded-xl bg-inset p-3" data-github-credential-add onSubmit={(event) => {
          event.preventDefault();
          const token = addSecret.trim();
          setAddSecret("");
          void run(() => changeGithubCredential({ op: "add", label: addLabel.trim(), token, ...(addScope === "org" ? { scope: "org" as const } : {}) })).then((ok) => {
            if (ok) { setAddLabel(""); setAdding(false); }
          });
        }}>
          <input value={addLabel} onChange={(event) => setAddLabel(event.target.value)} maxLength={80} placeholder={t("organization.githubTokens.labelPlaceholder")} aria-label={t("organization.githubTokens.label")} className={fieldClass} />
          <input type="password" autoComplete="off" spellCheck={false} value={addSecret} onChange={(event) => setAddSecret(event.target.value)} placeholder={t("plugins.tokenPlaceholder")} aria-label={t("organization.githubTokens.secret")} className={`${fieldClass} font-mono`} />
          {view.canManageOrg && (
            <div role="radiogroup" aria-label={t("sources.github.whose")} className="flex flex-wrap items-center gap-3 text-[12.5px]" data-github-credential-scope={addScope}>
              <span className="text-ink-secondary">{t("sources.github.whose")}</span>
              <label className="flex items-center gap-1.5"><input type="radio" name="github-credential-scope" checked={addScope === "mine"} onChange={() => setAddScope("mine")} />{t("sources.github.whoseMine")}</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="github-credential-scope" checked={addScope === "org"} onChange={() => setAddScope("org")} />{t("sources.github.whoseOrg")}</label>
            </div>
          )}
          <p className="text-[11.5px] leading-relaxed text-ink-secondary">{addScope === "org" ? t("sources.github.addHintOrg") : t("sources.github.addHint")}</p>
          {full && <p className="text-[12px] text-ink-secondary">{t("organization.githubTokens.limit", { max: addScope === "org" ? MAX_ORG_GITHUB_TOKENS : MAX_PERSON_GITHUB_CREDENTIALS })}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ui-button ui-button-primary" disabled={busy || full || !addLabel.trim() || addSecret.trim().length < 8}>{t("organization.githubTokens.add")}</button>
            <button type="button" className="ui-button" disabled={busy} onClick={() => { setAdding(false); setAddSecret(""); }}>{t("organization.githubTokens.cancel")}</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
