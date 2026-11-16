// Vitest global setup: one Local VM namespace for the whole run (see
// local-vm-namespace.ts), inherited by every worker, and its containers
// removed when the run ends.
import { createTestTempRoot } from "../../scripts/testing/test-temp.mjs";
import { newLocalVmTestNamespace, removeTestLocalVms } from "./local-vm-namespace.ts";

export default function setup() {
  const temp = createTestTempRoot();
  const namespace = process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE || newLocalVmTestNamespace();
  process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE = namespace;
  return async () => {
    try { await removeTestLocalVms(namespace); } finally { temp.cleanup(); }
  };
}
