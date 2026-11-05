// Live handle to the lot 5 installation capability store, set once at boot
// after migrateCapabilitiesStores. Readers of former JSON state files check
// this bridge and prefer the sealed store when the source is marked migrated.
import type { InstallationCapabilityDocument, InstallationCapabilityStore } from "./installation-capability-store.ts";

export type InstallationCapabilityBridge = {
  store: InstallationCapabilityStore;
  hasMigrated(sourceId: string): boolean;
  read(): InstallationCapabilityDocument;
  write(document: InstallationCapabilityDocument): void;
  patch(update: (document: InstallationCapabilityDocument) => void): void;
};

let bridge: InstallationCapabilityBridge | null = null;

export function setInstallationCapabilityBridge(next: InstallationCapabilityBridge | null): void {
  bridge = next;
}

export function installationCapabilityBridge(): InstallationCapabilityBridge | null {
  return bridge;
}

export function makeInstallationCapabilityBridge(store: InstallationCapabilityStore): InstallationCapabilityBridge {
  return {
    store,
    hasMigrated: (sourceId) => {
      try {
        return store.hasMigrated(sourceId);
      } catch {
        return false;
      }
    },
    read: () => store.read(),
    write: (document) => store.write(document),
    patch: (update) => {
      const document = store.read();
      update(document);
      store.write(document);
    },
  };
}
