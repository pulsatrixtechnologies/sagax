import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const storeFixture = vi.hoisted(() => ({ config: null as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: storeFixture.config }, dispatch: vi.fn() }) };
});

import {
  CloudComputersCard,
  LocalComputerSection,
  LocalVmAutoStatus,
  LocalVmIdleTimeoutSetting,
  LocalVmInventoryCard,
  VpsComputersCard,
  cloudComputerActionPlan,
  cloudComputerInventoryState,
  computerInventoryRequest,
  confirmComputerAction,
  localVmAutoAction,
  localVmAutoLabel,
  localVmEnsurePlan,
  localVmInventoryState,
  localVmResetPlan,
  parseLocalVmIdleTimeoutMinutes,
  reconcileCloudInventoryPayload,
  perBotLocalVmDeletePlan,
  reconcileCloudInventorySnapshot,
  vpsComputerRemovePlan,
  vpsComputerInventoryState,
  vpsComputerShortId,
  type CloudComputerInventoryInstance,
  type LocalVmAutoState,
  type LocalVmInventoryInstance,
  type VpsComputerInventoryInstance,
} from "./LocalComputerSection";

const cloudVm: LocalVmInventoryInstance = {
  botId: "cloud-bot",
  name: "Research",
  destination: "cloud",
  container: "running",
  ready: true,
  managed: true,
  problem: null,
  inUse: false,
};

const ownedCloudComputer: CloudComputerInventoryInstance = {
  boxId: "provider-id-must-not-render",
  name: "ogb-current0-a1b2c3",
  state: "ready",
  ownerBotId: "current-owner",
  ownerName: "Research",
  orphaned: false,
  inUse: false,
};

afterEach(() => setLocale("en"));

describe("computer inventory request wiring", () => {
  it("keeps every mount and refresh request observation-only", () => {
    const controller = new AbortController();
    const requests = ([
      ["status", "/api/local-computer"],
      ["local-vms", "/api/local-computer/instances"],
      ["cloud", "/api/computers/boxes"],
      ["vps", "/api/computers/vps"],
    ] as const).map(([kind, expectedUrl]) => ({
      expectedUrl,
      request: computerInventoryRequest(kind, controller.signal),
    }));

    for (const { expectedUrl, request: [url, init] } of requests) {
      expect(url).toBe(expectedUrl);
      expect(init).toEqual({ signal: controller.signal });
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
    }
  });

  it("does not expose a destructive request when confirmation is cancelled", () => {
    const confirm = vi.fn(() => false);
    const request = confirmComputerAction(perBotLocalVmDeletePlan(cloudVm), confirm);

    expect(request).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      "Delete Research's Local VM? Files in its durable folder will remain.",
    );
  });

  it("builds the exact confirmed Local VM, Boat, and VPS lifecycle requests", () => {
    const confirm = vi.fn(() => true);
    const local = confirmComputerAction(perBotLocalVmDeletePlan(cloudVm), confirm);
    const cloudDelete = confirmComputerAction(cloudComputerActionPlan("delete", ownedCloudComputer), confirm);
    const cloudSleep = confirmComputerAction(cloudComputerActionPlan("sleep", ownedCloudComputer), confirm);
    const vpsName = "openmausbot-vps-current-123456abcdef";
    const vps = confirmComputerAction(vpsComputerRemovePlan({
      name: vpsName,
      state: "running",
      ownerBotId: "current-owner",
      ownerName: "Research",
      orphaned: false,
      inUse: false,
    }), confirm);

    expect(local).toEqual([
      "/api/bots/cloud-bot/local-computer/remove",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ]);
    expect(cloudDelete).toEqual([
      "/api/computers/boxes/provider-id-must-not-render/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: ownedCloudComputer.name }),
      },
    ]);
    expect(cloudSleep).toEqual([
      "/api/computers/boxes/provider-id-must-not-render/sleep",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ]);
    expect(vps).toEqual([
      `/api/computers/vps/${vpsName}/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: vpsName }),
      },
    ]);
    // Sleep is reversible and intentionally skips confirmation; all three
    // destructive actions above remain explicitly gated.
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});

describe("Local VM inventory UI", () => {
  it("shows capacity, current destinations, health, and an in-use deletion guard", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [
        cloudVm,
        {
          botId: "off-bot",
          name: "Archive",
          destination: "off",
          container: "stopped",
          ready: false,
          managed: true,
          problem: "This desktop image cannot safely resume; recreate the Local VM",
          inUse: true,
        },
      ],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("2/4 created");
    expect(markup).toContain("Current destination: Cloud");
    expect(markup).toContain("Current destination: Off");
    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s turn before deleting its desktop.");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).not.toMatch(/viewer_url|workspace_path|password=/);
  });

  it("keeps state labels honest", () => {
    expect(localVmInventoryState(cloudVm)).toBe("Running");
    expect(localVmInventoryState({ ...cloudVm, ready: false })).toBe("Needs attention");
    expect(localVmInventoryState({ ...cloudVm, container: "stopped", ready: false })).toBe("Stopped");
    expect(localVmInventoryState({ ...cloudVm, inUse: true })).toBe("In use");
  });

  it("does not claim there are no VMs when the runtime cannot be inspected", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: "Start docker first",
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("Inventory unavailable");
    expect(markup).toContain("Start docker first");
    expect(markup).not.toContain("No per-bot desktops have been created");
  });

  it("disables deletion while refreshing an existing inventory", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [cloudVm],
      maxInstances: 4,
      loading: true,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    // Refresh and Delete cannot race one another.
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows unmanaged containers without offering an unsafe delete action", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmInventoryCard, {
      instances: [{
        ...cloudVm,
        managed: false,
        ready: false,
        problem: "Container labels do not match",
      }],
      maxInstances: 4,
      loading: false,
      deletingBotId: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).toContain("Not managed");
    expect(markup).toContain("not managed by Sagax");
    expect(markup).toContain("remove it directly in Docker or Podman");
    expect(markup).not.toContain(">Delete</button>");
    expect(markup).not.toContain("Container labels do not match");
  });
});

describe("cloud computer inventory UI", () => {
  const renderCard = (overrides: Partial<Parameters<typeof CloudComputersCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(CloudComputersCard, {
      instances: [],
      configured: true,
      loading: false,
      pending: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onSleep: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }));

  it("shows owners, orphans, lifecycle state and only the sanitized machine name", () => {
    const markup = renderCard({
      instances: [
        ownedCloudComputer,
        {
          boxId: "another-provider-id",
          name: "ogb-orphaned-abcdef",
          state: "archived",
          ownerBotId: null,
          ownerName: null,
          orphaned: true,
          inUse: false,
        },
      ],
    });

    expect(markup).toContain("Research");
    expect(markup).toContain("Owned by this bot");
    expect(markup).toContain("Orphaned computer");
    expect(markup).toContain("Its bot no longer exists");
    expect(markup).toContain("Running");
    expect(markup).toContain("Sleeping");
    expect(markup).toContain("ogb-current0-a1b2c3");
    expect(markup).not.toMatch(/provider-id-must-not-render|another-provider-id|desktopUrl|password|token=/);
  });

  it("disables destructive actions while the owner is working", () => {
    const markup = renderCard({ instances: [{ ...ownedCloudComputer, inUse: true }] });

    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s work before changing its computer.");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables lifecycle actions while refreshing an existing inventory", () => {
    const markup = renderCard({ instances: [ownedCloudComputer], loading: true });

    // Refresh, Sleep, and Delete all wait for one authoritative snapshot.
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("keeps disconnected, unavailable, and empty states distinct", () => {
    const disconnected = renderCard({ configured: false });
    expect(disconnected).toContain("Boat is not connected");
    expect(disconnected).not.toContain("No Sagax-managed cloud computers found");

    const unavailable = renderCard({ unavailableReason: "boat.dev is unavailable" });
    expect(unavailable).toContain("boat.dev is unavailable");
    expect(unavailable).not.toContain("No Sagax-managed cloud computers found");

    const endpointFailure = renderCard({ configured: null, unavailableReason: "Computer inventory could not load" });
    expect(endpointFailure).toContain("Computer inventory could not load");
    expect(endpointFailure).not.toContain("Boat is not connected");

    const empty = renderCard();
    expect(empty).toContain("No Sagax-managed cloud computers found");
  });

  it("uses honest state labels", () => {
    expect(cloudComputerInventoryState(ownedCloudComputer)).toBe("Running");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "archived" })).toBe("Sleeping");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "archiving" })).toBe("Going to sleep");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "removing" })).toBe("Removing");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "provisioning" })).toBe("Starting");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, state: "unknown" })).toBe("Needs attention");
    expect(cloudComputerInventoryState({ ...ownedCloudComputer, inUse: true })).toBe("In use");
  });

  it("keeps a provider-accepted deletion visible while it is still pending", () => {
    const pending = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "deleting" },
    );

    expect(pending.instances).toEqual([{ ...ownedCloudComputer, state: "removing" }]);
    expect(pending.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleting" });
    const markup = renderCard({ instances: pending.instances });
    expect(markup).toContain("Removing");
    // Sleep and Delete stay unavailable until the bounded confirmation pass
    // either observes absence or restores the provider's actual row.
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("clears a pending deletion only after inventory confirms absence", () => {
    const settled = reconcileCloudInventorySnapshot(
      [],
      [{ ...ownedCloudComputer, state: "removing" }],
      { [ownedCloudComputer.boxId]: "deleting" },
    );

    expect(settled.instances).toEqual([]);
    expect(settled.overrides).toEqual({});
  });

  it("does not treat an unavailable or unconfigured empty inventory as proof of deletion", () => {
    for (const payload of [
      { configured: true, available: false, problem: "Boat is unavailable", instances: [] },
      { configured: false, available: false, problem: null, instances: [] },
    ]) {
      const result = reconcileCloudInventoryPayload(
        payload,
        [{ ...ownedCloudComputer, state: "removing" }],
        { [ownedCloudComputer.boxId]: "deleting" },
      );

      expect(result.instances).toEqual([{ ...ownedCloudComputer, state: "removing" }]);
      expect(result.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleting" });
    }
  });

  it("keeps cloud badge meaning and delete requests stable when the language changes", () => {
    const englishPlan = cloudComputerActionPlan("delete", ownedCloudComputer);
    for (const [locale, running, sleeping] of [
      ["pt-br", "Em execução", "Dormindo"],
      ["ja", "実行中", "スリープ中"],
    ]) {
      setLocale(locale);
      expect(renderCard({ instances: [ownedCloudComputer] }))
        .toContain(`bg-accent/15 text-accent-text">${running}</span>`);
      expect(renderCard({ instances: [{ ...ownedCloudComputer, state: "archived" }] }))
        .toContain(`bg-control text-ink-secondary">${sleeping}</span>`);
      const translatedPlan = cloudComputerActionPlan("delete", ownedCloudComputer);
      expect(translatedPlan.confirmation).not.toBe(englishPlan.confirmation);
      expect(translatedPlan.confirmation).toContain(ownedCloudComputer.ownerName);
      expect(translatedPlan.request).toEqual(englishPlan.request);
    }
  });

  it("does not let an eventually-consistent list resurrect a deleted computer", () => {
    const first = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "deleted" },
    );
    expect(first.instances).toEqual([]);
    expect(first.overrides).toEqual({ [ownedCloudComputer.boxId]: "deleted" });

    const later = reconcileCloudInventorySnapshot(
      [ownedCloudComputer],
      first.instances,
      first.overrides,
    );
    expect(later.instances).toEqual([]);

    const confirmedAbsent = reconcileCloudInventorySnapshot(
      [],
      later.instances,
      later.overrides,
    );
    expect(confirmedAbsent.instances).toEqual([]);
    expect(confirmedAbsent.overrides).toEqual({});
  });

  it("keeps a successful sleep visible until LIST reaches a sleeping state", () => {
    const stale = reconcileCloudInventorySnapshot(
      [{ ...ownedCloudComputer, state: "running" }],
      [ownedCloudComputer],
      { [ownedCloudComputer.boxId]: "sleeping" },
    );
    expect(stale.instances[0]?.state).toBe("archived");
    expect(stale.overrides).toEqual({ [ownedCloudComputer.boxId]: "sleeping" });

    const missing = reconcileCloudInventorySnapshot([], stale.instances, stale.overrides);
    expect(missing.instances[0]?.state).toBe("archived");
    expect(missing.overrides).toEqual(stale.overrides);

    const settled = reconcileCloudInventorySnapshot(
      [{ ...ownedCloudComputer, state: "stopped" }],
      missing.instances,
      missing.overrides,
    );
    expect(settled.instances[0]?.state).toBe("stopped");
    expect(settled.overrides).toEqual({});
  });

  it("announces cloud loading and action errors", () => {
    const loading = renderCard({ loading: true });
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');

    const failed = renderCard({ error: "Could not delete this computer" });
    expect(failed).toContain('role="alert"');
  });
});

describe("VPS computer inventory UI", () => {
  const ownedVps: VpsComputerInventoryInstance = {
    name: "openmausbot-vps-current-123456abcdef",
    state: "running",
    ownerBotId: "current-owner",
    ownerName: "Research",
    orphaned: false,
    inUse: false,
  };
  const renderCard = (overrides: Partial<Parameters<typeof VpsComputersCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(VpsComputersCard, {
      instances: [],
      configured: true,
      sshAlias: "production-vps",
      loading: false,
      removingName: null,
      error: null,
      unavailableReason: null,
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
      ...overrides,
    }));

  it("shows the configured host, owners, orphans, and status without raw container details", () => {
    const orphanName = "openmausbot-vps-deleted-abcdef123456";
    const markup = renderCard({
      instances: [
        ownedVps,
        {
          name: orphanName,
          state: "exited",
          ownerBotId: null,
          ownerName: null,
          orphaned: true,
          inUse: false,
        },
      ],
    });

    expect(markup).toContain("SSH host: production-vps");
    expect(markup).toContain("Research");
    expect(markup).toContain("Owned by this bot");
    expect(markup).toContain(">Orphaned VPS computer<");
    expect(markup).not.toContain("· ID ef123456");
    expect(markup).toContain("Its bot no longer exists");
    expect(markup).toContain("Running");
    expect(markup).toContain("Stopped");
    expect(markup).not.toMatch(new RegExp(`${ownedVps.name}|${orphanName}|containerId|VNC_PW|password`));
  });

  it("derives a stable identifier without exposing the bot-derived container name", () => {
    expect(vpsComputerShortId("openmausbot-vps-deleted-abcdef123456")).toBe("ef123456");
    expect(vpsComputerShortId("unexpected-provider-name")).toBe("unknown");
  });

  it("disables removal while the owner is working", () => {
    const markup = renderCard({ instances: [{ ...ownedVps, inUse: true }] });

    expect(markup).toContain("In use");
    expect(markup).toContain("Stop this bot&#x27;s work before removing its VPS computer.");
    expect(markup).toContain("disabled=\"\"");
  });

  it("disables removal while refreshing an existing inventory", () => {
    const markup = renderCard({ instances: [ownedVps], loading: true });

    // Refresh and Remove cannot race one another.
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("keeps disconnected, unavailable, and empty states distinct", () => {
    expect(renderCard({ configured: false, sshAlias: null })).toContain("VPS is not configured");
    expect(renderCard({ unavailableReason: "SSH host cannot be reached" })).toContain("SSH host cannot be reached");
    expect(renderCard()).toContain("No Sagax-managed VPS computers found");
  });

  it("uses honest status labels", () => {
    expect(vpsComputerInventoryState(ownedVps)).toBe("Running");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "exited" })).toBe("Stopped");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "paused" })).toBe("Paused");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "restarting" })).toBe("Restarting");
    expect(vpsComputerInventoryState({ ...ownedVps, state: "dead" })).toBe("Needs attention");
    expect(vpsComputerInventoryState({ ...ownedVps, inUse: true })).toBe("In use");
  });

  it("keeps running and paused VPS badge colors when labels are translated", () => {
    setLocale("pt-br");
    const running = renderCard({ instances: [ownedVps] });
    expect(running).toContain('bg-accent/15 text-accent-text">Em execução</span>');
    expect(running).toContain("Remover");
    expect(running).not.toContain(">Remove</button>");
    expect(renderCard({ instances: [{ ...ownedVps, state: "paused" }] }))
      .toContain('bg-control text-ink-secondary">Pausado</span>');
  });
});

describe("Settings → Computers", () => {
  afterEach(() => { storeFixture.config = null; });
  // Settings cards are collapsible here: the title is the first span of the card's toggle.
  const cards = () => [...renderToStaticMarkup(createElement(LocalComputerSection)).matchAll(/<button type="button" aria-expanded="[a-z]+"[^>]*><span class="min-w-0 truncate">([^<]+)<\/span>/g)].map((match) => match[1]);

  // 0.5.6: the Local VM is a row of the "Bots' computer" group, not a card.
  const html = () => renderToStaticMarkup(createElement(LocalComputerSection));

  it("sets up a Local VM on a desktop or self-hosted server", () => {
    expect(cards()).toContain("Setup");
    expect(html()).toMatch(/data-settings-group="botsComputer"[\s\S]*data-settings-row="localVm"[\s\S]*>Local VM</);
    // Boat Computer is experimental: its card shows only when switched on.
    expect(cards()).not.toContain("Cloud computers");
    storeFixture.config = { features: { skillAuthoring: true, boatComputer: true } };
    expect(cards()).toContain("Cloud computers");
  });

  it("keeps Local VM when a leftover Cloud home flag is present", () => {
    storeFixture.config = { cloudHome: true };
    const titles = cards();
    expect(titles).not.toContain("Cloud computers");
    expect(html()).toContain('data-settings-row="localVm"');
    expect(titles).toContain("Setup");
  });
});

describe("Local VM automatic care", () => {
  const auto = (patch: Partial<LocalVmAutoState>): LocalVmAutoState => ({
    phase: "idle",
    step: null,
    problem: null,
    detail: null,
    attempts: 0,
    nextRetryAt: null,
    stoppedByPerson: false,
    ...patch,
  });
  const row = (props: Partial<Parameters<typeof LocalVmAutoStatus>[0]> = {}) =>
    renderToStaticMarkup(createElement(LocalVmAutoStatus, {
      auto: auto({ phase: "running" }),
      perBot: false,
      busy: false,
      onEnsure: () => {},
      onReset: () => {},
      ...props,
    }));

  it("labels what the care is doing, and stays quiet when the badge says it", () => {
    expect(localVmAutoLabel(auto({ phase: "starting", step: "image" }))).toBe("Downloading the desktop image…");
    expect(localVmAutoLabel(auto({ phase: "starting", step: "start" }))).toBe("Starting the Local VM desktop…");
    expect(localVmAutoLabel(auto({ phase: "checking" }))).toBe("Checking the Local VM…");
    expect(localVmAutoLabel(auto({ phase: "stopped", stoppedByPerson: true }))).toBe("You stopped the Local VM: it stays down until you start it.");
    expect(localVmAutoLabel(auto({ phase: "waiting", nextRetryAt: Date.now() + 30_000 }))).toMatch(/^New automatic attempt at /);
    expect(localVmAutoLabel(auto({ phase: "running" }))).toBeNull();
    expect(localVmAutoLabel(auto({ phase: "idle" }))).toBeNull();
  });

  it("says each problem in the person's language", () => {
    expect(localVmAutoLabel(auto({ phase: "problem", problem: "image_failed" }))).toBe("The desktop image could not be downloaded.");
    expect(localVmAutoLabel(auto({ phase: "problem", problem: "no_runtime" }))).toBe("No container runtime is installed.");
    setLocale("fr");
    expect(localVmAutoLabel(auto({ phase: "problem", problem: "no_runtime" }))).toBe("Aucun moteur de conteneurs n'est installé.");
    expect(localVmAutoLabel(auto({ phase: "starting", step: "container" }))).toBe("Création de la VM locale…");
  });

  it("offers the person's action only where one helps", () => {
    expect(localVmAutoAction(auto({ phase: "stopped", stoppedByPerson: true }))).toBe("start");
    expect(localVmAutoAction(auto({ phase: "problem", problem: "start_failed" }))).toBe("retry");
    expect(localVmAutoAction(auto({ phase: "waiting", nextRetryAt: Date.now() + 30_000 }))).toBe("retry");
    expect(localVmAutoAction(auto({ phase: "starting", step: "image" }))).toBeNull();
    expect(localVmAutoAction(auto({ phase: "running" }))).toBeNull();
  });

  it("starts without asking and resets only once confirmed", () => {
    const ensure = localVmEnsurePlan();
    expect(ensure.confirmation).toBeNull();
    expect(ensure.request).toEqual([
      "/api/local-computer/ensure",
      { method: "POST", headers: { "content-type": "application/json" }, body: '{"reason":"person"}' },
    ]);

    const confirm = vi.fn(() => true);
    const reset = confirmComputerAction(localVmResetPlan(false), confirm);
    expect(reset).toEqual([
      "/api/local-computer/reset",
      { method: "POST", headers: { "content-type": "application/json" }, body: '{"confirm":true}' },
    ]);
    expect(confirm).toHaveBeenCalledWith("Delete this computer's Local VM and let Sagax create it again? Files saved on this computer are kept.");
    expect(confirmComputerAction(localVmResetPlan(true), () => false)).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("renders the care line only where the desktop app runs it", () => {
    expect(row({ auto: null })).toBe("");
    const done = row();
    expect(done).not.toContain("data-local-vm-auto-action");
    expect(done).toContain('data-local-vm-reset');
    expect(done).toContain("Reset");

    const failed = row({ auto: auto({ phase: "problem", problem: "image_failed", detail: "registry timeout" }) });
    expect(failed).toContain("The desktop image could not be downloaded.");
    expect(failed).toContain("registry timeout");
    expect(failed).toContain('data-local-vm-auto-action="retry"');
    expect(failed).toContain("Retry now");

    const stopped = row({ auto: auto({ phase: "stopped", stoppedByPerson: true }) });
    expect(stopped).toContain('data-local-vm-auto-action="start"');
    expect(stopped).toContain("Start");
    expect(stopped).toContain("You stopped the Local VM: it stays down until you start it.");

    const working = row({ auto: auto({ phase: "starting", step: "container" }), busy: true });
    expect(working).toContain("Creating the Local VM…");
    expect(working).toContain("disabled");
  });
});

describe("Local VM idle timeout setting", () => {
  it.each([["5", 5], ["30", 30], [" 480 ", 480], ["1440", 1_440]])("accepts %j", (value, minutes) => {
    expect(parseLocalVmIdleTimeoutMinutes(value)).toBe(minutes);
  });

  it.each(["", "4", "1441", "1.5", "-30", "30m", "1e2"])("rejects %j", (value) => {
    expect(parseLocalVmIdleTimeoutMinutes(value)).toBeNull();
  });

  it("shows the confirmed window as a bounded, labelled minutes field", () => {
    const markup = renderToStaticMarkup(createElement(LocalVmIdleTimeoutSetting, {
      minutes: 30,
      disabled: false,
      onSave: async () => {},
    }));
    expect(markup).toContain('for="local-vm-idle-timeout"');
    expect(markup).toContain("Stop unused desktops after");
    expect(markup).toContain('min="5"');
    expect(markup).toContain('max="1440"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain("minutes");
  });
});
