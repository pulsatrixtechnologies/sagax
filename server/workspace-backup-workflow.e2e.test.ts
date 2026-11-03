import { expect, it } from "vitest";
import { verifyWorkspaceBackup, verifyWorkspaceBackupLibrarySkills } from "../scripts/verify/dev/verify-workspace-backup.ts";

it("restores an encrypted workspace through the real server and continues its original chat", async () => {
  const result = await verifyWorkspaceBackup();
  console.info(JSON.stringify(result));
  expect(result).toMatchObject({
    ok: true, identicalIds: true, transcriptPreserved: true, conversationContinued: true,
    attachmentBytesPreserved: true, skillAndProfilePreserved: true, sourceCredentialsExcluded: true, destinationCredentialsUnchanged: true,
    clientStateAllowlisted: true, oldDataSafetyCopy: true,
  });
}, 150_000);

it("restores organization library skills into a fresh install: listed, readable and assigned as before", async () => {
  const result = await verifyWorkspaceBackupLibrarySkills();
  console.info(JSON.stringify(result));
  expect(result).toMatchObject({ ok: true, listed: true, readable: true, assigned: true, sealedStoreExcluded: true });
}, 150_000);
