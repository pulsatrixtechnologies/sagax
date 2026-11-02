# Cutover and rollback: production sandboxes to the Kubernetes pool

Production today is the production VM `<VM_NAME>` in
`<RESOURCE_GROUP>` (`<REGION>`, `<VM_SIZE>`). Sagax, the
provisioner and the sandboxes share that VM, and the provisioner is the
only container with the Docker socket (`docs/user-sandbox.md`).

This cutover moves **sandboxes** to the pool in `deploy/k8s/sandboxes/`.
It does not resize the VM, and it does not move Sagax off the VM. Those
are different changes. The VM stays up for the whole procedure.

Do not apply the manifests, create a cluster, or run the `az` commands
below until the change record in `change-management.md` is approved.
This repository does not do that apply.

Two provisioners run side by side. The production compose service stays
`SANDBOX_BACKEND=docker` and keeps the Docker socket. A second process,
`deploy/k8s/provisioner/`, runs with `SANDBOX_BACKEND=kubernetes` and
talks to the Kubernetes API (`server/sandboxd-k8s/sandboxd-k8s.ts`). That value does
not exit. The pool manifests (`deploy/k8s/sandboxes/`), the Helm chart
and the OpenTofu modules (`deploy/k8s/helm/`, `deploy/k8s/tofu/`) are the
same tree.

Sagax chooses a provisioner per call (`server/sandbox-route.ts`):

| Variable | Effect |
|---|---|
| `SAGAX_SANDBOXD_URL` | Docker provisioner. Required. Stays `http`. |
| `SAGAX_SANDBOXD_K8S_URL` | Kubernetes provisioner. `https` only. |
| `SAGAX_SANDBOXD_TLS_CA` | PEM CA Sagax uses for that https URL. Required when the URL is set. |
| `SAGAX_SANDBOX_CANARY_PEOPLE` | Principal ids (`pr_…`) whose environment uses Kubernetes. |
| `SAGAX_SANDBOX_CANARY_BOTS` | Bot ids whose turns use Kubernetes. |
| `SAGAX_SANDBOX_ROUTE` | `kubernetes` sends everyone. `docker` sends everyone, lists included. Unset uses the lists. |
| `SAGAX_SANDBOX_K8S_REGISTRY` | Image registry prefix on the Kubernetes provisioner. |
| `SAGAX_SANDBOX_K8S_REQUIRE_SIGNED` | Default true: the image ref must end in `@sha256:<64 hex>`. `latest` is refused. |
| `SAGAX_SANDBOX_K8S_WAKE_URL` | Optional. Secret https webhook that starts a stopped cluster. Sagax posts it when the Kubernetes provisioner does not answer, then waits. Never logged. |
| `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` | Optional. How long a call waits for the cluster to start. Default `480000` (8 minutes), at most `540000`. |

Revert traffic without stopping either provisioner: set
`SAGAX_SANDBOX_ROUTE=docker` and recreate only the Sagax process.

## Canary

A sandbox belongs to a person, not a bot. Prefer
`SAGAX_SANDBOX_CANARY_PEOPLE` for that person. `SAGAX_SANDBOX_CANARY_BOTS`
routes one bot's turns; it must name **every bot of that person**, or a
sibling bot keeps writing the Docker volume while the canary writes the
PVC.

Copy the workspace before the first Kubernetes turn
(`scripts/sandbox-workspace-migrate.ts`). The copy reads the source,
checks SHA-256, and a second run with the same bytes writes nothing.
`--direction pvc-to-docker` copies back. The source directory is not
deleted.

## Images

The Kubernetes provisioner admits `SAGAX_SANDBOX_IMAGE` only when it sits
under `SAGAX_SANDBOX_K8S_REGISTRY` and, unless
`SAGAX_SANDBOX_K8S_REQUIRE_SIGNED=0`, carries `@sha256:<64 hex>`. Record
the digest in the change record. The build script does not push.

## Downtime

Figures are estimates for a cutover done while the driver exists, from
the idle-stop default (10 minutes), the audit's node-boot range (30–90
seconds), a workspace copy of at most 32 GiB on the same region, and a
Sagax container recreate. They are not measurements from the production VM.

| Step | What changes | Who is interrupted | Estimate |
|---|---|---|---|
| 1 | Approve the change record. Build and record image digests. | Nobody | 0 |
| 2 | Create the cluster and apply the Azure overlay with the provisioner at 0 replicas. Confirm the placeholder subnet was replaced. | Nobody | 0 |
| 3 | Install **one** autoscaler (AKS node pool **or** Karpenter). Confirm a scale-up drill: one buffer replica goes Ready, then back to 0. | Nobody | 0. The drill's own node boot is 30–90 seconds and is not user traffic. |
| 4 | Install Velero and take one backup of the empty namespace. Restore it into `sandboxes-drill` and delete that namespace. | Nobody | 0 |
| 5 | Pick the canary person. Stop their Docker sandbox (`POST .../stop`). Copy `/workspace` to the PVC with `scripts/sandbox-workspace-migrate.ts --direction docker-to-pvc` and confirm the checksum line. | That person, if a bot is mid-command | **1–5 minutes** for that person. Everyone else: 0. |
| 6 | Set `SAGAX_SANDBOX_CANARY_PEOPLE` to that person (and `SAGAX_SANDBOX_CANARY_BOTS` to every bot of theirs). Set `SAGAX_SANDBOXD_K8S_URL` and `SAGAX_SANDBOXD_TLS_CA`. Recreate **only** the Sagax container. | Every open websocket and voice call drops once | **20–40 seconds** for everyone. In-flight turns fail and can be sent again. Their sandboxes are not deleted. |
| 7 | Watch one office day. `SagaxSandboxPendingTooLong` must not fire for the canary. | Nobody if the warm node is up. First command on a cold node adds **30–90 seconds** once. | 0 planned |
| 8 | Delete the ScaledObject `sagax-sandbox-pending` so real pods are not double-reserved. | Nobody | 0 |
| 9 | Add the next people by repeating step 5, batching step 6 into **one** recreate. | Each person: **1–5 minutes** while their disk is copied. One **20–40 second** websocket drop for the batch. | as above |
| 10 | Full cutover: `SAGAX_SANDBOX_ROUTE=kubernetes` on Sagax, recreate Sagax once. The Docker provisioner stays `SANDBOX_BACKEND=docker`. The Kubernetes provisioner stays `SANDBOX_BACKEND=kubernetes`. | Everyone, one websocket drop | **20–40 seconds**. A person whose pod starts on the warm node waits about **10–30 seconds** for the first command; a cold node adds **30–90 seconds**. |
| 11 | After a quiet day, stop using the Docker provisioner for new work. Leave `SANDBOX_BACKEND=docker` in the compose file so `SAGAX_SANDBOX_ROUTE=docker` still has a process to return to. | Nobody, if step 10 is healthy. Recreating the old provisioner is not a Sagax restart. | 0 |

Planned user-visible interruption for a one-person canary then a full
flip: one or two **20–40 second** drops, plus **1–5 minutes** per person
while that person's disk is copied. The VM is not deallocated.

## Cluster stopped when idle

When the cluster is stopped by a runbook after a period with no sandbox
Pod, set `SAGAX_SANDBOX_K8S_WAKE_URL` on the Sagax container to the
webhook that starts it, and recreate that container. The value is a
secret: put it in the secret store of the Sagax container, never in the
compose file, a change record or a ticket. The behaviour is in
`docs/sandbox-kubernetes.md` ("Cluster stopped when idle").

| Situation | What people see | Estimate |
|---|---|---|
| A turn needs the environment and the cluster is stopped | One row "The server environment is starting" in the conversation, then the tool call runs | the cluster start time, usually a few minutes, at most `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` |
| The cluster does not start in time | The tool call fails with "did not start in time"; the message can be sent again | the timeout |
| The Computer tab while the cluster is stopped | The environment reads off; Start wakes the cluster | 0 until Start |

Checks for the runbook, once:

1. It counts only Pods labelled `com.pulsatrix.sagax.sandbox.user` in the
   sandbox namespace, never the provisioner (`app=sagax-sandboxd`).
2. Its idle window (for example 30 to 45 minutes) starts after the last
   sandbox Pod is gone. Sagax sends no heartbeat; a Pod lives while its
   person works and until `SAGAX_SANDBOX_IDLE_MINUTES` after their last
   command.
3. A start request on a running cluster does nothing harmful.
4. Drill: stop the cluster, send a message to a canary bot that runs a
   command, and confirm one webhook call, the row in the conversation, and
   the command's answer. The Sagax log shows "start webhook accepted" and
   "the Kubernetes provisioner answers again", never the URL.

Rollback of the wake alone: unset `SAGAX_SANDBOX_K8S_WAKE_URL` and
recreate the Sagax container. A stopped cluster then fails calls routed to
Kubernetes, as before. To send everyone to Docker instead, use the
rollback below.

## Health check after every step

1. `GET /api/health` on Sagax returns success.
2. The Docker provisioner's `GET /healthz` on port 8791 returns success
   until step 11.
3. Once the Kubernetes provisioner is scaled to 1, its `GET /healthz`
   returns success and a ready probe is Ready. Sagax reaches it only
   over https with `SAGAX_SANDBOXD_TLS_CA`.
4. The canary person's next tool call reaches Kubernetes. A person who
   is not listed still reaches Docker. `SAGAX_SANDBOX_ROUTE=docker` sends
   both back to Docker on the next Sagax process.
5. No page from `base/prometheus-rules.yaml` is firing.

## Rollback

Set `SAGAX_SANDBOX_ROUTE=docker` on the Sagax container and recreate
that container. The lists can stay. Both provisioners stay up. To copy
a PVC back, run `scripts/sandbox-workspace-migrate.ts --direction
pvc-to-docker` before the next Docker turn. The PVC is not deleted.

| Situation | Extra work | Estimate |
|---|---|---|
| Canary only, no one wrote on the PVC | Env flip and recreate | **20–40 seconds** for everyone |
| Someone wrote on a PVC | Copy that workspace back onto the Docker volume, then the env flip | **1–5 minutes** for that person, plus **20–40 seconds** for everyone |
| Kubernetes provisioner was scaled up and then Sagax was reverted | Leave it up or scale it to 0. Sagax is on Docker. | **0** for users |

Rollback does not resize the VM and does not restore a Velero backup
unless the Docker volume was destroyed. That restore is
`backup-restore.md`.

## AKS node pool (cluster-autoscaler)

Use this **or** `adapters/azure/karpenter.yaml`, not both. `max-count` 1
is the starting cap. Azure counts vCPU quota per VM family and region:
check the quota of the pool's own `--node-vm-size` family, which is not
necessarily the production VM's family (the VM only counts against it when
both are in the same family). Raising it is a separate change record.

```bash
az aks nodepool add \
  --resource-group <RESOURCE_GROUP> \
  --cluster-name REPLACE_CLUSTER \
  --name sbox \
  --mode User \
  --node-count 0 \
  --enable-cluster-autoscaler \
  --min-count 0 \
  --max-count 1 \
  --node-vm-size <VM_SIZE> \
  --os-sku Ubuntu \
  --node-taints sagax.io/pool=sandboxes:NoSchedule \
  --labels sagax.io/pool=sandboxes
```

Self-managed clusters on Azure VMs use
`adapters/azure/cluster-autoscaler.values.yaml` instead of this command.

## SOC 2

Evidence for change approval and this procedure: CC8.1, CC5.2.
Evidence for the capacity and the rollback: A1.1, A1.2, CC7.5.
The map is `soc2-evidence.md`.
