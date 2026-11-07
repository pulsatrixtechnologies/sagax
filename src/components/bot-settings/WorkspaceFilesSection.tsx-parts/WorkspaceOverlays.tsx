import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { AttachmentPreviewDialog } from "../../AttachmentPreview";
import { ConfirmDialog } from "../../ConfirmDialog";
import { buttonCls } from "./helpers";
import { MovePopover } from "./menus";
import type { useWorkspaceFiles } from "./useWorkspaceFiles";

type Files = ReturnType<typeof useWorkspaceFiles>;

export function WorkspaceOverlays({ files }: { files: Files }) {
  const {
    moving, setMoving, folderChoices, movePaths, removing, setRemoving, deleteBody, confirmDelete,
    preview, setPreview, pdfUrl, setPdfUrl,
  } = files;
  return (
    <>
      {moving && (
        <MovePopover
          folders={folderChoices}
          onPick={(folder) => movePaths(moving.paths, folder)}
          onClose={() => setMoving(null)}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t(removing && removing.paths.length > 1 ? "persona.files.bulkDelete" : "persona.files.delete", { name: removing?.name ?? "" })}
        body={deleteBody()}
        confirmLabel={t("common.delete")}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={confirmDelete}
      />

      {preview && <AttachmentPreviewDialog image={preview} onClose={() => setPreview(null)} />}
      {pdfUrl && <PdfDialog pdf={pdfUrl} onClose={() => { URL.revokeObjectURL(pdfUrl.url); setPdfUrl(null); }} />}
    </>
  );
}

/** A PDF of the folder, read in place; Escape or Close puts it away. */
function PdfDialog({ pdf, onClose }: { pdf: { name: string; url: string }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6" data-workspace-pdf="" role="dialog" aria-modal="true" aria-label={pdf.name}>
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{pdf.name}</span>
          <a className={buttonCls} href={pdf.url} download={pdf.name}>{t("attach.download")}</a>
          <button type="button" className={buttonCls} onClick={onClose}>{t("common.close")}</button>
        </div>
        <iframe title={pdf.name} src={pdf.url} className="min-h-0 flex-1 bg-white" />
      </div>
    </div>
  );
}
