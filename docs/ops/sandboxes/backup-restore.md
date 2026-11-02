# Backup, restore, and the sandbox drill

Workspaces are the per-person volumes (`SAGAX_SANDBOX_DISK_MB`, default
32768 since 2026-11-02, was 2048). On the pool they are PersistentVolumeClaims in `sandboxes`,
reclaim `Retain`, on a disk class that detaches. The Docker volumes on
the production VM stay the copy of record until that person has been cut over
and one off-site backup of the PVC has succeeded.

## What is backed up

Velero `Schedule` `sandboxes-daily` (`deploy/k8s/sandboxes/base/velero-schedule.yaml`):

- Cron `0 11 * * *` UTC (07:00 EDT, 06:00 EST), before the warm window.
- The `sandboxes` namespace, volume snapshots included.
- TTL 720 hours (30 days).
- Storage location `sandboxes`. On Azure that is a Blob container
  (`adapters/azure/backup-location.yaml`), which is not the node disk.
  The storage account name is `REPLACE_STORAGE_ACCOUNT` until the change
  record fills it. The credential secret `velero-azure` is created
  outside git.

The production VM's existing disk backup is unchanged by this document. Do not
turn it off as part of the sandbox cutover.

## Targets

| | Target | Basis |
|---|---|---|
| RPO | 24 hours | one successful daily snapshot |
| RTO, one workspace | 30 minutes | snapshot restore of at most 32 GiB plus a pod start |
| RTO, the namespace | 90 minutes | every volume, then the provisioner Ready check |

These are planning targets, not timings from a drill. The first drill
fills `templates/drill-record.md` and replaces a target if the drill
missed it.

## Restore one person

1. Page is `SagaxSandboxVolumeNearFull` or a person reports a lost
   workspace. Open an incident (`incident-response.md`) if the volume
   was deleted or the backup is stale.
2. Find the last successful backup:
   `kubectl -n velero get backup -l velero.io/schedule-name=sandboxes-daily`.
3. Restore only that claim into a new namespace first
   (`sandboxes-drill`), not over the live claim.
4. If the drill copy mounts and the file list matches the record, restore
   the claim into `sandboxes` under the person's volume name while
   their sandbox is stopped.
5. Their tools are unavailable from the stop until the pod is Ready.
   Estimate **15–30 minutes**. Everyone else stays up.

## Drill

Run before step 10 of the cutover, and once a quarter after that. The
drill namespace is `sandboxes-drill`. Delete it at the end. Do not
restore over the production Docker volumes.

1. Confirm `SagaxSandboxBackupStale` is not firing. The alert exists only
   after Velero has published one success timestamp; the drill is what
   proves the first backup, and the alert covers the ones after it.
2. Restore the latest backup into `sandboxes-drill`.
3. Start one pod from `sagax-sandbox-pod-template` against a restored
   claim. `GET` the provisioner `/healthz`. List the workspace. Write
   one file, read it back, delete the pod.
4. Delete the drill namespace.
5. Fill `templates/drill-record.md` and attach it to the change record.
   A drill with no record does not count.

A failed drill is an incident of severity ticket, or page if last
night's backup is the one that failed (`SagaxSandboxBackupStale`).

## Rollback of a bad restore

If a restore replaced a live claim, stop that person's sandbox and
restore the previous backup the same way. Estimate another **15–30
minutes** for that person. If the Docker volume on the production VM still has
their files, copy from there with
`scripts/sandbox-workspace-migrate.ts --direction pvc-to-docker` and set
`SAGAX_SANDBOX_ROUTE=docker` for the rollback in `cutover-rollback.md`.

## SOC 2

Evidence for the schedule, the off-site location, and the drill record:
A1.2, A1.3, CC7.5, CC9.1. The map is `soc2-evidence.md`.
