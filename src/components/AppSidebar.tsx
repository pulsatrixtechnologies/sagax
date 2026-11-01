// The app shell's sidebar, by window width (2026-11-01, like Grok Bot's
// window, which collapses its sidebar to icons at 700 px):
//   - a phone (below 640px, Tailwind's `sm`): a drawer over the chat, opened
//     by the menu button in the top-left corner, closed by its scrim, by
//     Escape or by picking a conversation;
//   - 640 to 768px: the icons rail, in the flow, automatically;
//   - 768px and up: the person's own density (full, compact or the rail).
// The rail between them is the window's: it never changes the saved density
// (src/lib/sidebar-preferences.ts, `effectiveSidebarDensity`).
import { useEffect, useRef } from "react";
import { Menu } from "lucide-react";
import { t } from "@/lib/i18n";
import { useSidebarViewport } from "@/lib/sidebar-preferences";
import { Sidebar } from "./Sidebar";

export function AppSidebar({ drawerOpen, onDrawerOpenChange, composeOpen, onCompose }: {
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  composeOpen: boolean;
  onCompose: () => void;
}) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const viewport = useSidebarViewport();
  // A drawer left open while the window widens past a phone would keep its
  // scrim's state (and the native views it hides) with nothing to close.
  useEffect(() => {
    if (viewport !== "phone" && drawerOpen) onDrawerOpenChange(false);
  }, [viewport, drawerOpen, onDrawerOpenChange]);
  return (
    <>
      <button
        type="button"
        ref={menuButtonRef}
        data-drawer-button=""
        aria-label={t("app.openBotList")}
        aria-expanded={drawerOpen}
        onClick={() => onDrawerOpenChange(true)}
        className="absolute left-3 top-3 z-30 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink sm:hidden"
      >
        <Menu size={18} />
      </button>
      {drawerOpen && (
        <div
          aria-hidden
          data-drawer-scrim=""
          onMouseDown={(e) => e.target === e.currentTarget && onDrawerOpenChange(false)}
          className="absolute inset-0 z-30 bg-black/50 sm:hidden"
        />
      )}
      <Sidebar
        open={drawerOpen}
        composeOpen={composeOpen}
        onCompose={onCompose}
        onClose={() => {
          onDrawerOpenChange(false);
          menuButtonRef.current?.focus();
        }}
      />
    </>
  );
}
