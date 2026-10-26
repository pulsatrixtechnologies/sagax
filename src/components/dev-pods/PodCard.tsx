// One pod on screen: its rounded card, header (title, figure, collapse,
// options menu, also on right click) and body, inside its own error
// boundary. A pod that throws, in its data hook or its body, shows its own
// error card with Try again; the other pods never notice.
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SIDE_CARD, SIDE_CARD_HEADER, SIDE_CARD_ICON_BUTTON } from "@/lib/side-card";
import { useMenuMotion } from "../MenuMotion";
import type { DevPodContext, DevPodDefinition } from "./registry";

export const POD_CARD = `dev-pod ${SIDE_CARD}`;
const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
const HEADER_ICON = SIDE_CARD_ICON_BUTTON;

export interface PodMenuActions {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onHide: () => void;
  /** Hide every pod in this conversation (the header button brings them back). */
  onDismissThread: () => void;
  /** Present while some pods are hidden. */
  onShowAll?: () => void;
}

function PodMenu({ name, open, onClose, actions }: { name: string; open: boolean; onClose: () => void; actions: PodMenuActions }) {
  const motion = useMenuMotion(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!motion.shown) return null;
  const run = (action: () => void) => () => { onClose(); action(); };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("devPods.menu.aria", { name })}
      className={cn("absolute right-1 top-9 z-40 flex w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5", motion.className)}
      {...motion.exitProps}
    >
      <button type="button" role="menuitem" className={MENU_ITEM} disabled={!actions.canMoveUp} onClick={run(actions.onMoveUp)}>{t("devPods.menu.moveUp")}</button>
      <button type="button" role="menuitem" className={MENU_ITEM} disabled={!actions.canMoveDown} onClick={run(actions.onMoveDown)}>{t("devPods.menu.moveDown")}</button>
      <button type="button" role="menuitem" data-pod-hide="" className={MENU_ITEM} onClick={run(actions.onHide)}>{t("devPods.menu.hide")}</button>
      {actions.onShowAll && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onShowAll)}>{t("devPods.menu.showAll")}</button>}
      <div aria-hidden="true" className="mx-2 my-0.5 h-px bg-hairline-weak" />
      <button type="button" role="menuitem" data-pods-dismiss="" className={MENU_ITEM} onClick={run(actions.onDismissThread)}>{t("devPods.dismiss")}</button>
    </div>
  );
}

/** The card around a pod's content: shared by ready, loading and error. */
export function PodFrame({
  id,
  title,
  icon: Icon,
  collapsible,
  collapsed,
  onToggleCollapsed,
  summary,
  actions,
  children,
}: {
  id: string;
  title: string;
  icon: DevPodDefinition["icon"];
  collapsible: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  summary?: ReactNode;
  actions: PodMenuActions;
  children?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const open = !collapsible || !collapsed;
  const bodyId = `dev-pod-${id}-body`;
  return (
    <section
      data-dev-pod={id}
      data-collapsed={open ? undefined : ""}
      aria-label={title}
      className={cn(POD_CARD, "relative")}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className={cn("group/podhead", SIDE_CARD_HEADER)}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? t("devPods.collapse", { name: title }) : t("devPods.expand", { name: title })}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px]">{title}</span>
            {summary}
            <ChevronDown size={14} aria-hidden="true" className={cn("dev-pod-chevron shrink-0 text-ink-secondary", !open && "-rotate-90")} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px]">{title}</span>
            {summary}
          </div>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("devPods.menu.aria", { name: title })}
          title={t("devPods.menu.aria", { name: title })}
          onClick={() => setMenuOpen((value) => !value)}
          className={cn(HEADER_ICON, "opacity-0 touch:opacity-100 focus-visible:opacity-100 group-hover/podhead:opacity-100", menuOpen && "opacity-100")}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      <PodMenu name={title} open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} />
      {open && children ? <div id={bodyId} className="px-3 pb-3 text-[12.5px] leading-[18px]">{children}</div> : null}
    </section>
  );
}

interface PodChrome {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actions: PodMenuActions;
  /** Whether the pod has something on screen (not empty). */
  onPresence: (id: string, present: boolean) => void;
}

/** Runs the pod's data hook and draws its state. Inside the boundary, so a
 * throw in either lands on this pod's error card. */
function PodHost({ definition, ctx, chrome }: { definition: DevPodDefinition; ctx: DevPodContext; chrome: PodChrome }) {
  const data = definition.useData(ctx);
  const present = data.status !== "empty";
  const { onPresence } = chrome;
  useEffect(() => {
    onPresence(definition.id, present);
  }, [onPresence, definition.id, present]);
  if (data.status === "empty") return null;
  const frame = {
    id: definition.id,
    title: definition.title(),
    icon: definition.icon,
    collapsible: definition.collapsible,
    collapsed: chrome.collapsed,
    onToggleCollapsed: chrome.onToggleCollapsed,
    actions: chrome.actions,
  };
  if (data.status === "loading") {
    return (
      <PodFrame {...frame}>
        <div data-pod-state="loading" role="status" aria-label={t("devPods.loading")} className="flex flex-col gap-1.5">
          <span className="h-3 w-3/4 animate-pulse rounded bg-hover" />
          <span className="h-3 w-1/2 animate-pulse rounded bg-hover" />
        </div>
      </PodFrame>
    );
  }
  if (data.status === "error") {
    return (
      <PodFrame {...frame}>
        <PodError message={data.message} onRetry={data.retry} />
      </PodFrame>
    );
  }
  const { Body, Summary } = definition;
  return (
    <PodFrame {...frame} summary={Summary ? <Summary data={data.data} ctx={ctx} /> : undefined}>
      <Body data={data.data} ctx={ctx} />
    </PodFrame>
  );
}

function PodError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div data-pod-state="error" role="alert" className="flex items-center justify-between gap-2 text-ink-secondary">
      <span className="min-w-0 flex-1">{message || t("devPods.error")}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-ink hover:bg-hover">
          {t("devPods.retry")}
        </button>
      )}
    </div>
  );
}

/** Reports a pod that threw as present: its error card is on screen. */
function ErrorPresence({ id, onPresence }: { id: string; onPresence: PodChrome["onPresence"] }) {
  useEffect(() => { onPresence(id, true); }, [id, onPresence]);
  return null;
}

class PodBoundary extends Component<{ definition: DevPodDefinition; chrome: PodChrome; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn(`[dev-pods] ${this.props.definition.id} failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { definition, chrome } = this.props;
    return (
      <>
        <ErrorPresence id={definition.id} onPresence={chrome.onPresence} />
        <PodFrame
          id={definition.id}
          title={definition.title()}
          icon={definition.icon}
          collapsible={false}
          collapsed={false}
          onToggleCollapsed={chrome.onToggleCollapsed}
          actions={chrome.actions}
        >
          <PodError onRetry={() => this.setState({ failed: false })} />
        </PodFrame>
      </>
    );
  }
}

export function DevPod({ definition, ctx, chrome }: { definition: DevPodDefinition; ctx: DevPodContext; chrome: PodChrome }) {
  return (
    <PodBoundary definition={definition} chrome={chrome}>
      <PodHost definition={definition} ctx={ctx} chrome={chrome} />
    </PodBoundary>
  );
}
