// Settings > Local models: who a person's own computer models are shared
// with (D-20261123-023): chosen people and teams of the organization, beside
// the whole-organization switch. The search and the rows are the ones a
// page's share draws (ShareRecipients.tsx); this block says "team" throughout,
// the word of its own title.
import { t } from "@/lib/i18n";
import { withInvite } from "@/lib/page-share-plan";
import type { LocalModelRecipients as Recipients } from "@/lib/desktop-local-models";
import type { OrgDirectory } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { ShareRecipientRows, ShareRecipientSearch } from "../ShareRecipients";
import { FIELD, cardCount } from "../SettingsPrimitives";

export function LocalModelSharing({ directory, viewerId, value, onChange }: {
  directory: OrgDirectory | null;
  viewerId: string | null;
  value: Recipients;
  onChange: (next: Recipients) => void;
}) {
  const count = value.people.length + value.teams.length;

  return (
    <div className="flex flex-col gap-2" data-local-models-recipients={count}>
      <ShareRecipientSearch directory={directory} value={value} viewerId={viewerId}
        label={t("botSettings.sharing.searchPeopleTeams")} teamLine={(people) => `${t("localModels.shareTeam")} · ${cardCount("people", people)}`}
        onAdd={(entry) => onChange(withInvite(value, entry, true))}
        inputClassName={cn(FIELD, "w-full text-[13px]")} menuClassName="rounded-lg border-[0.5px] border-border" />
      {count > 0 && (
        <ul aria-label={t("localModels.shareWith")} className="flex flex-col gap-1.5">
          <ShareRecipientRows directory={directory} value={value} unknownTeam={t("localModels.shareTeamUnknown")} rowAttribute="data-local-models-recipient"
            onRemove={(entry) => onChange(withInvite(value, entry, false))} />
        </ul>
      )}
    </div>
  );
}
