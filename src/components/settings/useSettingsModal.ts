import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { osPermissionsAvailable } from "@/lib/os-permissions";

import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { servedPage } from "@/lib/desktop";
import { navigate } from "@/lib/view-transitions";
import { peopleListServed, readMembership } from "@/lib/membership";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { canEditConfig, canManageBackups, canManageComputers, canManageExperimental, viewerCan } from "@/lib/viewer";
import { currentSettingsSection, isMovedOrganizationCard } from "@/lib/settings-sections";
import { requestAbout } from "@/lib/about-ui";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesSettingsSection } from "@/lib/interface-visibility";
import { applySettingsSearch, clearSettingsSearch, settingsSearchLabels } from "@/lib/settings-search";
import { requestSettingsCard, takeRequestedSettingsCard } from "@/components/SettingsPrimitives";
import { useStore, type AppSettingsSection } from "@/state/store";
import { useRetroSkin } from "../RetroChromeHost";
import { useServerMode } from "../ServerModeSettings";
import { workspacesAvailable } from "../WorkspacesSection";
import { isSoloDesktop } from "./AdvancedSettings";
import {
  HOSTED_CARDS,
  ORGANIZATION_ADVANCED_KEYWORDS,
  SECTIONS,
  cardsMatching,
  memberHidesSection,
  organizationHidesSection,
  orgMemoryAvailable,
  publishedPagesMatch,
  sectionMatches,
} from "./settings-nav";
import { SUB_PAGES } from "./settings-sub-pages";

export function useSettingsModal() {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const retroSkin = useRetroSkin();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  // An old section id opens the page that holds it now. A remote client
  // shows this desktop's own pages only (Appearance, Organization,
  // Notifications); Pair devices, its old landing page, is hidden since
  // 2026-10-14, so it lands on Appearance.
  const current = currentSettingsSection(state.appSettingsSection);
  const requested: AppSettingsSection =
    remoteActive && current !== "appearance" && current !== "organization" && current !== "notifications" && current !== "updates" && current !== "general" && current !== "about"
      ? "appearance"
      : current;
  const dialogRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [searchLabels, setSearchLabels] = useState<string[]>([]);
  // Closing fades the dialog out, then goes back out of Settings (#2791).
  const closeSettings = () => navigate(() => dispatch({ type: "toggleAppSettings", open: false }), "back", "page", dialogRef.current);
  const openAbout = useCallback(() => {
    dispatch({ type: "toggleAppSettings", open: false });
    requestAbout();
  }, [dispatch]);
  const [query, setQuery] = useState("");
  useEffect(() => window.ogb?.environments?.onOpenSettings?.(() => setQuery("")), []);
  useEffect(() => window.ogb?.onOpenAppSettings?.(() => setQuery("")), []);
  const q = query.trim().toLowerCase();
  const ownerOrAdmin = useOwnerOrAdmin();
  const editConfig = canEditConfig(state.config);
  const manageComputers = canManageComputers(state.config);
  const manageBackups = canManageBackups(state.config);
  const manageExperimental = canManageExperimental(state.config);
  // Server mode: this app shows its organization's server only (src/lib/launch.ts).
  const serverMode = useServerMode();
  const lockedServer = serverMode?.active ? serverMode : null;
  // An organization server (Perspicax): the desktop locked to one, or a
  // page whose server answers GET /api/org as Perspicax.
  const perspicaxOrg = usePerspicaxOrg();
  const organization = Boolean(lockedServer) || perspicaxOrg !== null;
  const soloDesktop = isSoloDesktop(state.config);
  // Whether a section id (a page, or a former page that is a card now) may
  // show for this viewer. A card keeps the rules its section had.
  const allowed = (id: AppSettingsSection): boolean => {
    // a remote client shows the pages that are about this desktop
    if (remoteActive && !["appearance", "organization", "privacy", "notifications", "memory", "updates", "general", "about"].includes(id)) return false;
    // this app's own updates: where the desktop app answers
    if (id === "updates" && !window.ogb?.updater) return false;
    // the OS permissions of this computer: where the desktop app reads them
    if (id === "permissions" && !osPermissionsAvailable()) return false;
    // the organization memory's local cache is the desktop app's (main
    // process), set up by itself on an organization server signed in with
    // Perspicax: nothing to show anywhere else
    if (id === "memory" && !(orgMemoryAvailable() && perspicaxOrg !== null)) return false;
    // the desktop app in "No server" mode has no organization to show; it
    // joins one from General > Server, which brings this section back
    if (id === "organization" && soloDesktop) return false;
    // the operator's screen for other workspaces exists only where a fleet agent does
    if (id === "workspaces" && !workspacesAvailable(state.config)) return false;
    // sign-in by email is a served solo server's (the desktop app pairs
    // devices under Remote access), or the read-only view of a hosted
    // workspace whose members the organisation's Admin decides. An
    // organization server sends no sign-in list: Perspicax owns its people.
    // A served page, in a browser or drawn by the desktop app on that server
    // (electron/bundled-ui.cjs): the same server shows the same sections.
    if (id === "people" && !(servedPage() && (readMembership(state.config).authority === "portal" || peopleListServed(state.config)))) return false;
    // how the server sends sign-in codes and invitations: its admins and
    // the operator, on the desktop and on the web
    if (id === "mail" && ownerOrAdmin !== true) return false;
    if (organizationHidesSection(id, organization)) return false;
    // the activity log belongs to a workspace served to a browser, and to its admins
    // (2026-10-09: and to a person whose profile includes people.activityLog)
    if (id === "activity" && !(servedPage() && (ownerOrAdmin === true || (perspicaxOrg !== null && viewerCan(state.config, "people.activityLog"))))) return false;
    // Installation writes the server refuses with 403: hide the section.
    if (memberHidesSection(id, { editConfig, manageComputers, manageBackups, organization, manageExperimental, personalSettings: state.config?.personalSettings === true })) return false;
    // #2093: Decision model always shows on Models; its own master switch
    // is the only control (no Experimental gate).
    // Simple hides technical sections. Their saved values stay.
    return advanced || !simpleHidesSettingsSection(id);
  };
  const memoryShown = allowed("memory");
  // A request for Settings > Organization (the Server menu, a deep link) on
  // a desktop with no server opens the launch screen on Server instead,
  // unless the page holds this computer's organization memory.
  // A link to a card moved from General > Advanced opens General, where
  // those cards live under Advanced on a solo desktop (JC 2026-11-06).
  useEffect(() => {
    if (!soloDesktop || memoryShown || state.appSettingsSection !== "organization") return;
    if (isMovedOrganizationCard(takeRequestedSettingsCard())) {
      dispatch({ type: "toggleAppSettings", open: true, section: "general" });
      return;
    }
    dispatch({ type: "toggleAppSettings", open: false, section: "account" });
    dispatch({ type: "toggleLaunch", open: true, mode: "server" });
  }, [soloDesktop, memoryShown, state.appSettingsSection, dispatch]);
  // A page shows when it is allowed, or when one of the cards it holds is.
  const availableSections = SECTIONS.filter((entry) => allowed(entry.id) || (HOSTED_CARDS[entry.id] ?? []).some(allowed));
  // A page this viewer cannot see (an old link to Email where People is not
  // shown, a hidden page) draws the first page they can, at once.
  const section: AppSettingsSection = availableSections.some((entry) => entry.id === requested) ? requested : availableSections[0]?.id ?? requested;
  // On a solo desktop the org-advanced rows live on General, so its search matches their words.
  const visibleSections = availableSections.filter((entry) => sectionMatches(entry, q, soloDesktop && entry.id === "general" ? ORGANIZATION_ADVANCED_KEYWORDS : []));
  const pagesHit = Boolean(q) && publishedPagesMatch(q);
  const sectionLabelKey = SECTIONS.find((entry) => entry.id === section)?.labelKey;
  // #2080: every page has its one sentence under the title, drawn by the modal.
  const sectionIntroKey = SECTIONS.find((entry) => entry.id === section)?.introKey;
  const subPageId = state.appSettingsSubPage;
  const subPage = subPageId && SUB_PAGES[subPageId]?.section === section ? SUB_PAGES[subPageId] : null;
  const openSubPage = (id: string) => dispatch({ type: "toggleAppSettings", open: true, section: SUB_PAGES[id].section, subPage: id });
  const closeSubPage = useCallback(() => {
    const from = state.appSettingsSubPage;
    dispatch({ type: "toggleAppSettings", open: true, section });
    // Back where the person left: the row that opened the page.
    if (from && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const row = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === from);
        row?.querySelector<HTMLElement>("button")?.focus();
      });
    }
  }, [dispatch, section, state.appSettingsSubPage]);
  const nextVisibleSection = visibleSections.some((entry) => entry.id === section) ? undefined : visibleSections[0]?.id;

  useEffect(() => {
    for (const id of cardsMatching(q)) requestSettingsCard(id);
  }, [q]);

  // Searching shows the matching sections, not the page that was open.
  useEffect(() => {
    if (q && subPage) dispatch({ type: "toggleAppSettings", open: true, section });
  }, [q, subPage, section, dispatch]);

  useEffect(() => {
    // Translated matches can change without the query changing. Follow the
    // rendered results instead of a second filter with stale effect inputs.
    if (nextVisibleSection) dispatch({ type: "toggleAppSettings", open: true, section: nextVisibleSection });
  }, [dispatch, nextVisibleSection]);

  // The open page hides the rows that do not match and scrolls to the first
  // one. A disclosure that opens later is filtered again, without jumping.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || !q) {
      if (pane) clearSettingsSearch(pane);
      setSearchLabels((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let scroll = true;
    const apply = () => {
      const hit = applySettingsSearch(pane, q);
      const labels = settingsSearchLabels(pane);
      setSearchLabels((prev) => (prev.length === labels.length && prev.every((label, index) => label === labels[index]) ? prev : labels));
      if (scroll && hit) hit.scrollIntoView({ block: "center", inline: "nearest" });
      scroll = false;
    };
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(pane, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearSettingsSearch(pane);
    };
  }, [q, section, subPage]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const search = dialog?.querySelector<HTMLInputElement>("[data-settings-search]");
    if (search?.checkVisibility()) search.focus();
    else dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      // A child editor owns Escape and its focus trap, including while saving.
      if (event.defaultPrevented || (dialog && [...dialog.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
        .some(child => child.getClientRects().length))) return;
      // A window over Settings in the shared dialog layer (portalled to the
      // body, so not inside Settings) owns the keys typed inside it: the
      // Vault's New item, Manage, Edit, Import and Export (#4094).
      if (event.target instanceof Element && event.target.closest("[data-dialog-layer]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(() => dispatch({ type: "toggleAppSettings", open: false }), "back", "page", dialogRef.current);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.checkVisibility());
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);


  return {
    state,
    dispatch,
    advanced,
    retroSkin,
    remoteActive,
    dialogRef,
    paneRef,
    searchLabels,
    closeSettings,
    openAbout,
    query,
    setQuery,
    q,
    editConfig,
    lockedServer,
    allowed,
    memoryShown,
    availableSections,
    section,
    visibleSections,
    pagesHit,
    sectionLabelKey,
    sectionIntroKey,
    subPageId,
    subPage,
    openSubPage,
    closeSubPage,
  };
}
