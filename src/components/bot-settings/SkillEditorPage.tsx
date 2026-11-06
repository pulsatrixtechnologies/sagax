// Person-UI skill editor: the same MarkdownEditor as MEMORY.md / RULES.md,
// view by default, Edit then Save. Frontmatter (name, description) validated.
// When SKILL.md changed outside a review, Review changes opens a diff with
// Accept (re-sign) or Revert. Supporting files list beside the body.
import { useEffect, useMemo, useState } from "react";
import { File as FileIcon, Loader2 } from "lucide-react";

import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  skillEditorApiPath,
  skillSourceLabel,
  type SkillEditorFile,
  type SkillEditorOrigin,
  type SkillEditorPayload,
} from "@/lib/skills-ui";
import { composeSkillMd, isSkillName, parseSkillMd } from "../../../shared/skill-md";
import { AttachmentPreviewDialog, type PreviewImage } from "../AttachmentPreview";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { InlineFold, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { PanelPage } from "./PanelPage";
import { useBotEditor } from "./BotEditorContext";

export type SkillEditorTarget = {
  name: string;
  origin?: SkillEditorOrigin;
  /** Open already in edit mode (row menu Edit). */
  startEditing?: boolean;
};

type Mode = "view" | "edit" | "review";

const fieldClass = cn(inputCls, "w-full");

export function SkillEditorPage({
  botId,
  target,
  onClose,
  onPanelClose,
  onSaved,
}: {
  botId: string;
  target: SkillEditorTarget;
  onClose: () => void;
  onPanelClose?: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const { request: api } = useBotEditor();
  const [payload, setPayload] = useState<SkillEditorPayload | null>(null);
  const [mode, setMode] = useState<Mode>(target.startEditing ? "edit" : "view");
  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openFile, setOpenFile] = useState<{ path: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);

  const basePath = skillEditorApiPath(botId, target.name, target.origin);

  const reload = async () => {
    setError("");
    const result = (await api(basePath)) as SkillEditorPayload;
    setPayload(result);
    const parsed = parseSkillMd(result.text);
    if ("error" in parsed) {
      setName(result.name);
      setDescription(result.description);
      setInstructions(result.text);
    } else {
      setName(parsed.name);
      setDescription(parsed.description);
      setInstructions(parsed.body.trim());
    }
  };

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setMode(target.startEditing ? "edit" : "view");
    setOpenFile(null);
    void (async () => {
      try {
        await reload();
      } catch (cause) {
        if (!cancelled) setError(readableError(cause) || t("botPanel.skills.viewError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, target.name, target.origin]);

  const nameOk = isSkillName(name.trim());
  const dirty = useMemo(() => {
    if (!payload) return false;
    const parsed = parseSkillMd(payload.text);
    if ("error" in parsed) return true;
    return parsed.name !== name.trim() || parsed.description !== description.trim() || parsed.body.trim() !== instructions.trim();
  }, [payload, name, description, instructions]);

  const canSave = Boolean(payload?.editable) && mode === "edit" && nameOk && description.trim() !== "" && dirty && !busy;

  const save = async () => {
    if (!payload || !canSave) return;
    setBusy(true);
    setError("");
    try {
      await api(basePath, {
        method: "PUT",
        body: JSON.stringify({ name: name.trim(), description: description.trim(), instructions }),
      });
      setMode("view");
      onSaved();
      // Reload under the possibly renamed path.
      const nextPath = skillEditorApiPath(botId, name.trim(), target.origin);
      const result = (await api(nextPath)) as SkillEditorPayload;
      setPayload(result);
    } catch (cause) {
      setError(readableError(cause) || t("botPanel.skills.updateError"));
    } finally {
      setBusy(false);
    }
  };

  const reviewAction = async (action: "accept" | "revert") => {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      await api(`${basePath}/review`, { method: "POST", body: JSON.stringify({ action }) });
      setMode("view");
      onSaved();
      await reload();
    } catch (cause) {
      setError(readableError(cause) || t("botPanel.skills.updateError"));
    } finally {
      setBusy(false);
    }
  };

  const openSupporting = async (file: SkillEditorFile) => {
    setError("");
    if (file.kind === "image" || file.kind === "pdf") {
      setPreview({
        src: `${basePath}/files?path=${encodeURIComponent(file.path)}`,
        name: file.path,
        downloadUrl: `${basePath}/files?path=${encodeURIComponent(file.path)}`,
      });
      return;
    }
    if (file.kind !== "text") {
      setError(t("botPanel.skills.fileNotPreviewable", { path: file.path }));
      return;
    }
    try {
      const result = (await api(`${basePath}/files?path=${encodeURIComponent(file.path)}`)) as { text?: string };
      setOpenFile({ path: file.path, text: result.text ?? "" });
    } catch (cause) {
      setError(readableError(cause) || t("botPanel.skills.viewError"));
    }
  };

  const title = openFile ? openFile.path : mode === "review" ? t("botPanel.skills.reviewChangesTitle", { name: target.name }) : target.name;

  return (
    <PanelPage
      name={title}
      onBack={() => {
        void (async () => {
          if (busy) return;
          if (openFile) {
            setOpenFile(null);
            return;
          }
          if (mode === "review") {
            setMode("view");
            return;
          }
          if (mode === "edit" && dirty && !(await confirm(discardConfirmRequest(t("botPanel.skills.discardConfirm"))))) return;
          onClose();
        })();
      }}
      onClose={onPanelClose ?? onClose}
      closeLabel={t("botPanel.skills.close")}
      data-skill-editor-page=""
      bodyClassName="flex flex-col px-4 py-4"
      footer={
        mode === "review" ? (
          <>
            <span className="flex-1" />
            <button type="button" disabled={busy} className={PILL} onClick={() => void reviewAction("revert")}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : t("botPanel.skills.revert")}
            </button>
            <button type="button" disabled={busy} className={PRIMARY_PILL} onClick={() => void reviewAction("accept")}>
              {t("botPanel.skills.accept")}
            </button>
          </>
        ) : openFile ? (
          <p className="mr-auto text-[12px] text-ink-secondary">{t("botPanel.skills.supportingReadOnly")}</p>
        ) : mode === "edit" ? (
          <>
            <span className="flex-1" />
            <button type="button" disabled={busy} className={PILL} onClick={() => { setMode("view"); void reload(); }}>
              {t("common.cancel")}
            </button>
            <button type="button" disabled={!canSave} className={PRIMARY_PILL} onClick={() => void save()} data-skill-save="">
              {busy ? <Loader2 size={13} className="animate-spin" /> : t("common.save")}
            </button>
          </>
        ) : (
          <>
            <span className="flex-1" />
            {payload?.editable && (
              <button type="button" disabled={busy || !payload} className={PRIMARY_PILL} onClick={() => setMode("edit")} data-skill-edit="">
                {t("botPanel.skills.edit")}
              </button>
            )}
          </>
        )
      }
    >
      {!payload && !error && <p className="text-[12px] text-ink-secondary">{t("botPanel.loading")}</p>}
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}

      {payload && mode !== "review" && !openFile && (
        <div className="mb-3 flex flex-col gap-2">
          {payload.changedAfterReview && (
            <div role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning" data-skill-changed-after-review="">
              <div>{t("botPanel.skills.changedAfterReview")}</div>
              <button
                type="button"
                className="mt-1 font-medium text-accent-text hover:underline"
                onClick={() => setMode("review")}
                data-skill-review-changes=""
              >
                {t("botPanel.skills.reviewChanges")}
              </button>
            </div>
          )}
          {!payload.editable && (
            <p role="note" className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">
              {t("botPanel.skills.readOnlyReason")}
            </p>
          )}
          <InlineFold label={t("botPanel.skills.sourceLabel", { label: skillSourceLabel(payload.source) })}>
            <p className="break-all font-mono text-[10.5px] text-ink-secondary" title={payload.source}>{payload.source}</p>
          </InlineFold>
        </div>
      )}

      {openFile && (
        <MarkdownEditor
          value={openFile.text}
          readOnly
          minHeight={280}
          maxHeight="none"
          ariaLabel={openFile.path}
          onChange={() => {}}
          dataField={`skill-file:${openFile.path}`}
          footer={<span>{openFile.path}</span>}
        />
      )}

      {payload && mode === "review" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3" data-skill-review-diff="">
          <p className="text-[12px] text-ink-secondary">{t("botPanel.skills.reviewChangesHelp")}</p>
          {payload.reviewedText === null ? (
            <p className="text-[12px] text-ink-secondary">{t("botPanel.skills.reviewNoSnapshot")}</p>
          ) : (
            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
              <div className="flex min-h-0 flex-col gap-1">
                <div className="text-[12px] font-medium text-ink">{t("botPanel.skills.reviewedVersion")}</div>
                <MarkdownEditor value={payload.reviewedText} readOnly minHeight={240} maxHeight="none" ariaLabel={t("botPanel.skills.reviewedVersion")} onChange={() => {}} dataField="skill-reviewed" />
              </div>
              <div className="flex min-h-0 flex-col gap-1">
                <div className="text-[12px] font-medium text-ink">{t("botPanel.skills.currentVersion")}</div>
                <MarkdownEditor value={payload.text} readOnly minHeight={240} maxHeight="none" ariaLabel={t("botPanel.skills.currentVersion")} onChange={() => {}} dataField="skill-current" />
              </div>
            </div>
          )}
        </div>
      )}

      {payload && mode !== "review" && !openFile && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink">{t("botPanel.skills.fieldName")}</span>
              <input
                value={name}
                disabled={mode !== "edit" || busy}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass}
                data-skill-field="name"
              />
              {name.trim() !== "" && !nameOk && (
                <span className="text-[11.5px] text-danger">{t("botPanel.skills.nameRule")}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink">{t("botPanel.skills.fieldDescription")}</span>
              <textarea
                value={description}
                disabled={mode !== "edit" || busy}
                maxLength={1024}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
                className={cn(fieldClass, "resize-y")}
                data-skill-field="description"
              />
            </label>
            <div className="flex min-h-0 flex-1 flex-col gap-1" data-skill-field="instructions">
              <span id="skill-editor-instructions" className="text-[12px] font-medium text-ink">
                {t("botPanel.skills.fieldInstructions")}
              </span>
              <MarkdownEditor
                value={instructions}
                readOnly={mode !== "edit"}
                minHeight={260}
                maxHeight="none"
                ariaLabelledBy="skill-editor-instructions"
                onChange={setInstructions}
                dataField="skill-instructions"
              />
            </div>
          </div>
          {payload.files.length > 0 && (
            <aside className="w-full shrink-0 lg:w-48" data-skill-supporting-files="">
              <div className="mb-1 text-[12px] font-medium text-ink">{t("botPanel.skills.supportingFiles")}</div>
              <ul className="flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated">
                {payload.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] text-ink hover:bg-hover"
                      onClick={() => void openSupporting(file)}
                    >
                      <FileIcon size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}

      {preview && <AttachmentPreviewDialog image={preview} onClose={() => setPreview(null)} />}
    </PanelPage>
  );
}

/** Compose SKILL.md for tests that stub the editor save body. */
export function previewSkillMd(name: string, description: string, instructions: string, previous: string | null = null): string {
  return composeSkillMd(previous, { name, description, body: instructions });
}
