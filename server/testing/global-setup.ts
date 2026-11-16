// Vitest global setup: one Local VM namespace for the whole run (see
// local-vm-namespace.ts), inherited by every worker, and its containers
// removed when the run ends.
import { fileURLToPath } from "node:url";
import { ensureGeneratedKnowledge } from "../../scripts/self-knowledge/ensure.mjs";
import { newLocalVmTestNamespace, removeTestLocalVms } from "./local-vm-namespace.ts";

export default async function setup() {
  await ensureGeneratedKnowledge(fileURLToPath(new URL("../../", import.meta.url)), true);
  const namespace = process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE || newLocalVmTestNamespace();
  process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE = namespace;
  return async () => { await removeTestLocalVms(namespace); };
}
