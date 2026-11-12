// The profile page's Share pill and its popover, Grok Bot style
// (2026-11-06): "Share this Bot" with Copy link at the right, a field that
// adds people or groups from the organization directory, then "Who has
// access": the owner, and each person or team with its
// level (the last choice removes the access). Same grants and calls as the
// Sharing section (useBotSharing + useGrantEditor, GET/PUT/DELETE
// /api/bots/:id/grants); the server decides who may change what.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, ChevronRight, Link2, Loader2, Share2, UserPlus, Users } from "lucide-react";

import { AnchoredPopover } from "../AnchoredPopover";
import { PILL, PillSelect, PLAIN_FIELD } from "../SettingsPrimitives";
import { grantEditable, levelLabel, useGrantEditor } from "../bot-settings/GrantEditor";
import { useBotSharing } from "../bot-settings/SharingSection";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";
import { copyText } from "@/lib/copy-text";
import { botRefUrl } from "@/lib/thread-refs";
import { initialsOf } from "@/lib/page-share-plan";
import { personLabel } from "@/lib/human-label";
import { personAvatarSrc } from "@/lib/profile-management";
import { permissionMissingText } from "@/lib/permissions";
import { usePerspicaxOrg, type GrantLevel, type OrgDirectoryPerson } from "@/lib/perspicax-org";

type Containing = { contains(target: unknown): boolean };

/** How long "Copied" stays on the Copy link pill. */
const COPIED_MS = 1500;

/** The last choice of a grant's level select. */
const REMOVE = "remove";

const ROW = "flex min-h-[48px] min-w-0 items-center gap-3 py-1.5";

/** The pill's wrapper, the popover, and any list a select inside the popover
 * opened (portalled to <body>, named by its trigger's aria-controls) all
 * count as inside: a press there leaves the popover open. */
function useShareDismissRoot(trigger: RefObject<HTMLElement | null>, popover: RefObject<HTMLElement | null>): RefObject<Containing | null> {
  return useMemo(
    () => ({
      get current(): Containing {
        return {
          contains: (target: unknown) => {
            if (trigger.current?.contains(target as Node) || popover.current?.contains(target as Node)) return true;
            const closest = (target as Partial<Element> | null)?.closest;
            if (typeof closest !== "function") return false;
            const list = closest.call(target, "[data-anchored-popover][id]");
            const id = list?.getAttribute("id");
            if (!id || !popover.current) return false;
            return [...popover.current.querySelectorAll("[aria-controls]")].some((node) => node.getAttribute("aria-controls") === id);
          },
        };
      },
    }) as RefObject<Containing | null>,
    [trigger, popover],
  );
}

function Avatar({ name, url, team }: { name: string; url?: string | undefined; team?: boolean }) {
  if (url) return <img src={url} alt="" className="size-8 shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-control text-[12px] text-ink-secondary">
      {team ? <Users size={14} /> : initialsOf(name)}
    </span>
  );
}

/** A person's second line: login, and the address when it says more. */
function personDetail(person: Pick<OrgDirectoryPerson, "login" | "email"> | undefined): string {
  if (!person) return "";
  const email = person.email && person.email !== person.login ? person.email : "";
  return [person.login, email].filter(Boolean).join(" · ");
}

function teamDetail(count: number): string {
  return `${t("botSettings.sharing.teams")} · ${t("botSettings.sharing.teamMembers", { count })}`;
}

/** The organization row's word, only when the access really is
 * organization-wide (visibility "everyone" or "admins"): a grant to a
 * person or a team never shows the organization as having access. */
function organizationAccess(bot: Pick<Bot, "visibility">): string | null {
  const visibility = bot.visibility;
  if (visibility === "everyone") return t("botSettings.visibility.everyone");
  if (visibility === "admins") return t("botSettings.visibility.admins");
  return null;
}

function Row({ avatar, title, detail, children, ...data }: {
  avatar: ReactNode;
  title: string;
  detail?: string;
  children?: ReactNode;
  [marker: `data-${string}`]: string | boolean | undefined;
}) {
  return (
    <li className={ROW} {...data}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] leading-5 text-ink">{title}</div>
        {detail && <div className="truncate text-[12px] leading-4 text-ink-secondary">{detail}</div>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </li>
  );
}

function SharePanel({ bot, directory, rows, administer, isOwner, mayShare, titleId }: ReturnType<typeof useBotSharing> & { bot: Bot; titleId: string }) {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const { grants, administer: rights, levels, query, setQuery, busy, error, candidates, canAdd, put, remove } = useGrantEditor({
    botId: bot.id,
    ...(bot.ownerUserId ? { ownerId: bot.ownerUserId } : {}),
    initialGrants: rows,
    initialAdminister: administer,
    directory,
  });
  const [picked, setPicked] = useState<Record<string, GrantLevel>>({});
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const people = useMemo(() => new Map((directory?.people ?? []).map((person) => [person.principalId.toLowerCase(), person])), [directory]);
  const teams = useMemo(() => new Map((directory?.teams ?? []).map((team) => [team.id, team])), [directory]);
  const ownerId = bot.ownerUserId?.toLowerCase();
  const owner = ownerId ? people.get(ownerId) : undefined;
  const viewer = state.config?.viewer;
  const profile = state.config?.profile;
  const ownerName = owner?.name || (isOwner || !ownerId ? personLabel(viewer?.name, profile?.name) : personLabel(undefined, ownerId));
  const ownerDetail = owner ? personDetail(owner) : isOwner || !ownerId ? (viewer?.email || profile?.email || "") : "";
  const ownerAvatar = personAvatarSrc(owner?.avatarUrl) ?? (isOwner || !ownerId ? personAvatarSrc(profile?.avatarUrl) : undefined);
  const orgName = org?.org.name || t("botProfile.share.organization");
  const orgAccess = organizationAccess(bot);
  const shown = grants.filter((grant) => grant.target.toLowerCase() !== `user:${ownerId ?? ""}`);
  const searchable = Boolean(rights) && canAdd && !(directory !== null && directory.people.length === 0 && !(directory.teams ?? []).length);

  const copy = () => {
    void copyText(botRefUrl(bot.id)).then((result) => {
      if (result !== "copied") return;
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  const detailOf = (target: string, kind: "user" | "team"): string => {
    const id = target.slice(target.indexOf(":") + 1);
    if (kind === "team") {
      const team = teams.get(id);
      return team ? teamDetail(team.members.length) : t("botSettings.sharing.teams");
    }
    return personDetail(people.get(id.toLowerCase()));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-ink">{t("botProfile.share.title")}</h2>
        <button type="button" onClick={copy} data-bot-share-copy className={cn(PILL, "shrink-0 gap-1.5")}>
          {copied ? <Check size={14} aria-hidden="true" className="text-success" /> : <Link2 size={14} aria-hidden="true" />}
          {copied ? t("botProfile.share.copied") : t("botProfile.share.copyLink")}
        </button>
      </div>

      {searchable ? (
        <div className="flex flex-col gap-1">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("botProfile.share.addPeople")}
            title={t("botSettings.sharing.search")}
            aria-label={t("botSettings.sharing.searchPeopleTeams")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            data-bot-share-search
            className={PLAIN_FIELD}
          />
          {rights && !rights.any && <p className="px-1 text-[12px] leading-4 text-ink-secondary">{t("botSettings.sharing.manager")}</p>}
          {query.trim() && candidates.length === 0 && <p className="px-1 py-1 text-[12px] leading-4 text-ink-secondary" data-bot-share-no-results>{t("botSettings.sharing.noMatch")}</p>}
          {candidates.length > 0 && (
            <ul className="flex flex-col" data-bot-share-results aria-label={t("botSettings.sharing.searchPeopleTeams")}>
              {candidates.map((candidate) => {
                const level = picked[candidate.target] ?? "use";
                const detail = candidate.kind === "team"
                  ? teamDetail(candidate.count ?? 0)
                  : personDetail({ login: candidate.detail ?? "", ...(candidate.email ? { email: candidate.email } : {}) });
                return (
                  <Row
                    key={candidate.target}
                    data-bot-share-candidate={candidate.target}
                    avatar={<Avatar name={candidate.label} team={candidate.kind === "team"} url={personAvatarSrc(candidate.avatarUrl)} />}
                    title={candidate.label}
                    detail={detail}
                  >
                    <PillSelect<GrantLevel>
                      value={level}
                      ariaLabel={`${t("botSettings.sharing.level")} · ${candidate.label}`}
                      disabled={busy !== null}
                      onChange={(next) => setPicked((current) => ({ ...current, [candidate.target]: next }))}
                      options={levels.map((option) => ({ value: option, label: levelLabel(option) }))}
                    />
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void put(candidate.target, level)}
                      data-bot-share-add
                      className={cn(PILL, "shrink-0 gap-1")}
                    >
                      {busy === candidate.target ? <Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <UserPlus size={12} aria-hidden="true" />}
                      {t("botSettings.sharing.add")}
                    </button>
                  </Row>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <p className="px-1 text-[12px] leading-4 text-ink-secondary" data-bot-share-status>
          {t(!rights ? "botSettings.sharing.ownerOnly" : !canAdd ? "botSettings.sharing.noAnchor" : "botSettings.sharing.noDirectory")}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <div className="px-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("botProfile.share.whoHasAccess")}</div>
        <ul className="flex flex-col" aria-label={t("botProfile.share.whoHasAccess")} data-bot-share-access>
          {orgAccess !== null && (
            <Row
              data-bot-share-org
              avatar={<span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-control text-[12px] text-ink-secondary">{initialsOf(orgName)}</span>}
              title={orgName}
            >
              <span className="text-[13px] text-ink-secondary">{orgAccess}</span>
              <ChevronRight size={14} aria-hidden="true" className="text-ink-tertiary" />
            </Row>
          )}
          <Row
            {...(ownerId ? { "data-grant": `user:${ownerId}` } : {})}
            data-bot-share-owner
            avatar={<Avatar name={ownerName} url={ownerAvatar} />}
            title={ownerName}
            {...(ownerDetail ? { detail: ownerDetail } : {})}
          >
            <span className="px-2.5 text-[13px] text-ink-secondary">{t("botProfile.share.owner")}</span>
          </Row>
          {shown.map((grant) => {
            const editable = grantEditable(grant, rights);
            const detail = detailOf(grant.target, grant.kind);
            return (
              <Row
                key={grant.target}
                data-grant={grant.target}
                avatar={<Avatar name={grant.label} team={grant.kind === "team"} url={grant.kind === "user" ? personAvatarSrc(people.get(grant.target.slice(5).toLowerCase())?.avatarUrl) : undefined} />}
                title={grant.label}
                {...(detail || grant.disabled ? { detail: [grant.disabled ? t("botSettings.sharing.disabled") : "", detail].filter(Boolean).join(" · ") } : {})}
              >
                {busy === grant.target && <Loader2 size={12} aria-hidden="true" className="animate-spin text-ink-secondary motion-reduce:animate-none" />}
                {editable ? (
                  <PillSelect<GrantLevel | typeof REMOVE>
                    value={grant.level}
                    ariaLabel={`${t("botSettings.sharing.level")} · ${grant.label}`}
                    disabled={busy !== null}
                    onChange={(next) => void (next === REMOVE ? remove(grant.target) : put(grant.target, next))}
                    options={[
                      ...levels.map((option) => ({ value: option, label: levelLabel(option) })),
                      { value: REMOVE, label: t("botProfile.share.remove") },
                    ]}
                  />
                ) : (
                  <span className="px-2.5 text-[13px] text-ink-secondary">{levelLabel(grant.level)}</span>
                )}
              </Row>
            );
          })}
        </ul>
        {shown.length === 0 && <p className="px-1 text-[12px] leading-4 text-ink-secondary">{t("botSettings.sharing.empty")}</p>}
      </div>

      <p className="px-1 text-[12px] leading-4 text-ink-secondary">{t("botSettings.sharing.notice")}</p>
      {isOwner && !mayShare && <p role="note" data-sharing-permission className="px-1 text-[12px] leading-4 text-ink-secondary">{permissionMissingText("sharing.grants")}</p>}
      {error && <p role="alert" className="px-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** Loads the directory and the grants only while the popover is open. */
function SharePopoverBody({ bot, titleId }: { bot: Bot; titleId: string }) {
  const sharing = useBotSharing(bot);
  // Rebuilt once the directory answers, so the rows carry its labels.
  return <SharePanel key={`${bot.id}:${sharing.directory ? "directory" : "loading"}`} {...sharing} bot={bot} titleId={titleId} />;
}

export function ShareBotButton({ bot, open, onOpenChange, style, className }: {
  bot: Bot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  style?: CSSProperties;
  className?: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const titleId = useId();
  const dismissRoot = useShareDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(open, dismissRoot, () => onOpenChange(false));

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => onOpenChange(!open)}
        data-bot-profile-share=""
        style={style}
        className={cn(CIRCLE_LABEL_BUTTON, className)}
      >
        <Share2 size={14} aria-hidden="true" />
        {t("botProfile.share")}
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          popoverRef={popoverRef}
          align="end"
          gap={6}
          id={popoverId}
          role="dialog"
          aria-labelledby={titleId}
          data-bot-share-popover
          className="w-[420px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
        >
          <SharePopoverBody bot={bot} titleId={titleId} />
        </AnchoredPopover>
      )}
    </>
  );
}
