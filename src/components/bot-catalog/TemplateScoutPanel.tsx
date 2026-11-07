// Browse Bots > Templates > Scout panel (#1383 extract).
import type { Dispatch, SetStateAction } from "react";
import { Compass, ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { TEAM_GLYPHS } from "./TeamImportDetails";
async function openExternal(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

const fieldCls = "min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";
const primaryCls = "flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60";

function ErrorLine({ error }: { error: string }) {
  if (!error) return null;
  return <div role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>;
}

export interface ScoutResult {
  profile: { name: string; summary: string; stacks: string[] };
  suggestion: {
    roomName: string;
    manifest: {
      team: { members: Array<{ key: string; name: string; title: string; description: string; appearance: { color: string } }> };
    };
    reasons: Record<string, string>;
  };
}

export interface DirectoryCandidate {
  slug: string;
  name: string;
  category: string;
  integrations: string[];
  prompt: string;
  detailUrl: string;
  matched: string[];
}

export function TemplateScoutPanel(props: {
  scoutFolder: string;
  setScoutFolder: Dispatch<SetStateAction<string>>;
  scoutTarget: string;
  scouting: boolean;
  scouted: ScoutResult | null;
  directory: DirectoryCandidate[] | null;
  pickedDirectory: Set<string>;
  setPickedDirectory: Dispatch<SetStateAction<Set<string>>>;
  roomName: string;
  setRoomName: Dispatch<SetStateAction<string>>;
  creating: boolean;
  error: string;
  pickScoutFolder: () => Promise<void>;
  runScout: (folder: string) => Promise<void>;
  createProject: () => Promise<void>;
}) {
  const {
    scoutFolder, setScoutFolder, scoutTarget, scouting, scouted, directory,
    pickedDirectory, setPickedDirectory, roomName, setRoomName, creating, error,
    pickScoutFolder, runScout, createProject,
  } = props;
  return (
          <div>
            <div className="mb-3 text-[12px] font-medium text-ink-secondary">{t("templateTools.scoutTitle")}</div>
            <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-secondary">
              {t("templateTools.scoutHelp")}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={scoutFolder}
                onChange={(event) => setScoutFolder(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && scoutTarget && void runScout(scoutTarget)}
                placeholder="/path/to/your/project"
                aria-label={t("templateTools.scoutFolder")}
                className={fieldCls}
              />
              {Boolean(window.ogb?.pickFolder) && (
                <button type="button" onClick={() => void pickScoutFolder()} disabled={scouting} className="ui-button disabled:opacity-40">
                  <FolderOpen size={14} />
                  {t("templateTools.browse")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void runScout(scoutTarget)}
                disabled={!scoutTarget || scouting}
                className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
              >
                {scouting ? <Loader2 size={14} className="animate-spin" /> : <Compass size={14} />}
                {scouting ? t("templateTools.scouting") : t("templateTools.scout")}
              </button>
            </div>

            {scouted && (
              <div className="mt-6">
                <div className="rounded-2xl bg-raised/25 px-5 py-4">
                  <div className="text-[15px] font-semibold text-ink">{scouted.profile.name}</div>
                  {scouted.profile.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{scouted.profile.summary}</p>}
                  {scouted.profile.stacks.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {scouted.profile.stacks.map((stack) => (
                        <span key={stack} className="rounded-full bg-raised px-2.5 py-1 text-[11.5px] text-ink-secondary">{stack}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-5 text-[12px] font-medium text-ink-secondary">{t("templateTools.suggested")}</div>
                <div className="mt-1 grid grid-cols-1 gap-x-10 md:grid-cols-2">
                  {scouted.suggestion.manifest.team.members.map((member, index) => (
                    <div key={member.key} className="flex min-h-[64px] items-center gap-3 border-b border-hairline/35 px-1 py-3">
                      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold", TEAM_GLYPHS[index % TEAM_GLYPHS.length])}>
                        {member.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        {/* name, then the title under it (JC: never "Name · Title" on one line) */}
                        <div data-member-name="" className="truncate text-[14px] font-medium text-ink">{member.name}</div>
                        {member.title && <div data-member-title="" className="truncate text-[12px] leading-4 text-ink-secondary">{member.title}</div>}
                        <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{scouted.suggestion.reasons[member.key] ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {directory && directory.length > 0 && (
                  <>
                    <div className="mt-5 text-[12px] font-medium text-ink-secondary">{t("templateTools.fromDirectory")}</div>
                    <div className="mt-1 flex flex-col">
                      {directory.map((candidate) => (
                        <div key={candidate.slug} className="flex items-center gap-3 border-b border-hairline/35 px-1 py-3">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={pickedDirectory.has(candidate.slug)}
                              onChange={() =>
                                setPickedDirectory((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(candidate.slug)) next.delete(candidate.slug);
                                  else next.add(candidate.slug);
                                  return next;
                                })
                              }
                              className="size-4 accent-accent"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-medium text-ink">
                                {candidate.name}
                                {candidate.category && <span className="font-normal text-ink-secondary"> · {candidate.category}</span>}
                              </div>
                              <div className="mt-0.5 truncate text-[12px] text-ink-secondary">Matches {candidate.matched.join(", ")}</div>
                            </div>
                          </label>
                          <button
                            type="button"
                            onClick={() => void openExternal(candidate.detailUrl)}
                            aria-label={t("templateTools.openCandidate", { name: candidate.name })}
                            title={t("templateTools.readBotPage")}
                            className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
                          >
                            <ExternalLink size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input value={roomName} onChange={(event) => setRoomName(event.target.value)} aria-label={t("templateTools.roomName")} className={fieldCls} />
                  <button type="button" onClick={() => void createProject()} disabled={creating} className={primaryCls}>
                    {creating && <Loader2 size={15} className="animate-spin" />}
                    {creating ? t("templateTools.creating") : t("templateTools.createRoom")}
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-ink-secondary">
                  {t("templateTools.createHelp")}
                </p>
              </div>
            )}
            <ErrorLine error={error} />
          </div>
  );
}
