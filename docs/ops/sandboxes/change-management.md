# Change management: sandbox pool

Production changes to the pool are pull requests against `develop` on
`pulsatrixtechnologies/sagax`. A merge to `main` is not this procedure,
and this change does not deploy.

## What a change must show

1. The pull request links the manifests and the runbook section it
   changes. Review is by someone other than the author. CI on the
   branch is green, including `server/sandbox/sandbox-backend.test.ts`.
2. The image is the digest that CI built, not a moving tag. The record
   stores the digest.
3. `kubectl diff` (or the Helm diff for the autoscaler values) is pasted
   into `templates/change-record.md` before apply. A diff that shows
   `192.0.2.10/32` still in place, or `replicas` above 0 on this image,
   is not applied.
4. Apply is a second person's action, from the approved SHA, to the
   named cluster. The applier writes the time, the command, and the
   resulting Ready state into the same record.
5. Rollback is the command in `cutover-rollback.md`
   (`SAGAX_SANDBOX_ROUTE=docker` on Sagax; the Docker provisioner stays
   `SANDBOX_BACKEND=docker`), written in the record before the apply
   starts.

## Deploy history

Keep one record per apply under the operator's change log (not in this
git tree if it contains a subnet or an account name that was filled
in). The minimum columns are: date, pull request, git SHA, image
digest, cluster name, who applied, who approved, health-check result,
rollback command. That list is the deploy history for the pool.

An apply with no record is rolled back.

## Emergency

A page may skip the pull request only for the rollback itself
(`SAGAX_SANDBOX_ROUTE=docker` on Sagax). The second person still
confirms it. The timeline goes into the incident note, and a pull
request the next business day records what production now runs.

## SOC 2

Evidence for authorization, review, and the deploy history: CC8.1,
CC5.2, CC2.2. The map is `soc2-evidence.md`.
