# Incident response: sandbox pool

Each alert in `deploy/k8s/sandboxes/base/prometheus-rules.yaml` is a
heading below. The annotation `runbook` on the alert is that heading.
Treat a firing alert as the start of the incident; do not wait for a
person to write in.

Severity `page` is answered when it fires, including outside the warm
window. Severity `ticket` is answered the next business hour. The production
VM itself is not restarted as a first action.

## Roles

- **Duty operator:** runs the steps, keeps the timeline in the incident
  note.
- **Second person:** required before a production rollback or a restore
  over a live volume (CC8.1 on the emergency change).
- **Communications:** one note in the operator channel when a page is
  declared, and one when it is closed. No workspace contents, tokens, or
  person keys in the note.

## SagaxSandboxdDown

Page. The provisioner Deployment has replicas and none are Ready.

1. `kubectl -n sandboxes describe deploy sagax-sandboxd` and the
   last logs. `SANDBOX_BACKEND=kubernetes` on this Deployment is the
   Kubernetes provisioner. It stays up. People still on Docker are
   unaffected. Downtime **0** until a canary person calls it.
2. Check `/healthz` from inside the pod and the ready probe. A missing
   CA or a registry digest the Deployment does not pin fails the probe.
3. Rollback criterion: Ready is false for 5 minutes, or new ensures fail.
   Set `SAGAX_SANDBOX_ROUTE=docker` and recreate Sagax (**20–40 seconds**
   for everyone). Both provisioners stay up. See `cutover-rollback.md`.

## SagaxSandboxPendingTooLong

Page. A `sagax-user-*` pod has been Pending for 3 minutes. A node boot
is 30–90 seconds, so 3 minutes means the autoscaler is not adding a node.

1. Confirm only one of cluster-autoscaler and Karpenter is installed.
2. Check the quota (`<REGION>` arm64). The Azure adapter ships a max
   of one `<VM_SIZE>` beside the production VM.
3. If the buffer ScaledObject `sagax-sandbox-pending` is still applied
   and the driver is also creating pods, delete the ScaledObject. That
   is the double-reservation case. Downtime **0**.
4. Rollback criterion: the canary person's pod is still Pending at 10
   minutes. Roll that person back (`cutover-rollback.md`).

## SagaxSandboxPoolSaturated

Page. The same Pending condition has lasted 10 minutes.

1. Do the Pending steps above.
2. If the pool is at its reviewed max, stop the canary. Do not raise the
   max inside the incident. A larger pool is a change record.
3. Rollback criterion: two people are waiting, or one person has waited
   10 minutes. `SAGAX_SANDBOX_ROUTE=docker` on Sagax.

## SagaxSandboxWarmNotReady

Ticket. The warm deployment was scaled above 0 and is not available.
The next sandbox that needs a new node waits **30–90 seconds**.

1. Check the KEDA ScaledObject `sagax-sandbox-warm` and the node pool.
2. A missed weekday morning is not a rollback. A warm node that never
   arrives during an active canary is `SagaxSandboxPendingTooLong` once
   a person is waiting.

## SagaxSandboxdRestarting

Page. The provisioner container restarted more than 3 times in 15
minutes.

1. Read the logs before deleting the pod.
2. A crash on startup (missing TLS files, an image without a digest)
   leaves people on Docker until the route points here. Fix the
   Deployment. Downtime **0** for people still on Docker.
3. Rollback criterion: restarts continue for another 15 minutes after a
   config fix. `SAGAX_SANDBOX_ROUTE=docker` on Sagax.

## SagaxSandboxNodeNotReady

Page. A node labelled `sagax.io/pool=sandboxes` has not been
Ready for 5 minutes.

1. See whether pods moved. A detached Azure disk can attach to the
   replacement node. A local-path disk cannot; that person stays down
   until the node returns or a backup is restored.
2. Rollback criterion: the node is the only one and it stays NotReady
   for 15 minutes during the canary. `SAGAX_SANDBOX_ROUTE=docker` for
   the people whose volumes were on it, after
   `scripts/sandbox-workspace-migrate.ts --direction pvc-to-docker` when
   the Docker copy is stale. Restore from Velero if the Docker copy was
   already removed (**15–30 minutes** for each of those people,
   `backup-restore.md`).

## SagaxSandboxVolumeNearFull

Ticket. A workspace is past 85 percent of its capacity. The soft quota
is `SAGAX_SANDBOX_DISK_MB` (32768).

1. Tell the person from the volume name only after you have confirmed
   which claim it is. Do not put file names in the incident note.
2. Expanding a Retain disk is a change on that claim, done while the
   sandbox is stopped. Estimate **5–10 minutes** for that person.
3. This is not a pool rollback.

## SagaxSandboxBackupStale

Page. The last successful daily backup is older than 26 hours. The
alert stays silent until Velero has published one success, so the first
backup is proved by the drill, not by this alert.

1. `kubectl -n velero describe schedule sandboxes-daily`.
2. Do not cut over another person while this alert is firing.
3. A restore from the previous good backup follows `backup-restore.md`.
4. Rollback criterion: the backup has been stale for the whole canary
   day. Stop the canary. People already moved stay if their Docker
   volume still exists; otherwise restore.

## Declaring and closing

Write the timeline as the alerts fire: alert name, time, what was done,
whether a rollback ran. Attach it to the change record for the
follow-up. Close the page only when the alert is green and the health
checks in the cutover runbook pass.

A security incident (a sandbox reaching a denied address, a second
person's files in a workspace, a provisioner ServiceAccount used outside
the namespace) uses the same timeline and adds: isolate the pod
(delete it, keep the claim), keep the Velero backup, and review access
(`access-review.md`) before the pool is opened again.

## SOC 2

Evidence for detection, evaluation, response, and recovery: CC7.1,
CC7.2, CC7.3, CC7.4, CC7.5, CC4.1. The map is `soc2-evidence.md`.
