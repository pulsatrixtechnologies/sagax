# History rewrite (operator only; not pull request #437)

This is the authorized public-rewrite plan. Dry-run transcripts live in
[`history-rewrite-dryrun.txt`](history-rewrite-dryrun.txt). Rewritten refs
were not pushed. This pull request must not force-push.

**Chart directory rename is #437, not #436.** HEAD already moved
`deploy/k8s/helm/<CHART_OLD>` to `deploy/k8s/helm/sandboxes`. History still
has the old directory name. The rewrite must path-rename it here. Do **not**
path-rename the image-gate workflow.

The authorized rewrite is every public `refs/heads/*` and `refs/tags/*`.
A GitHub `git clone --mirror` **can** advertise `refs/pull/*`. Delete them
before filter-repo. Do not rewrite pull refs; ask Support to purge them after
the force-push.

## Scope: every public head and tag, including PR #444's branch

Walk **all** remaining `refs/heads/*` and `refs/tags/*` after pull refs are
deleted. That includes `cursor/docker-image-cves-5d72`, the head of
[PR #444](https://github.com/pulsatrixtechnologies/Sagax/pull/444).

Commit `1b3bbe5eca386bf4bf4a5f28aa9ae51f66ad4fbf` on that branch: commit à
purger. A rewrite that only walks `main` (dry-run 1) never sees that commit. Dry-run 2 of a
complete origin `--mirror` did list `cursor/docker-image-cves-5d72` among the
public heads; keep that branch in the rewrite. If the branch is deleted before
the rewrite, the commit can still be reachable from `refs/pull/444/*` on
GitHub — see the Support purge below.

Do not skip any other open-PR head that is still a public `refs/heads/*`.

## 1. Private `--mirror` (offline)

```
git clone --mirror git@github.com:pulsatrixtechnologies/sagax.git sagax-pre-rewrite.mirror
git --git-dir=pre-rewrite.mirror for-each-ref --format='%(refname)' refs/pull \
  | while read r; do git --git-dir=pre-rewrite.mirror update-ref -d "$r"; done
git --git-dir=pre-rewrite.mirror for-each-ref --format='%(refname) %(objectname)'
gh release list --repo <PUBLIC_REPO> --limit 100
```

Confirm `refs/heads/cursor/docker-image-cves-5d72` is present (or record
that it was deleted and that `1b3bbe5e` is therefore only on GitHub's pull
refs). Never push that mirror to a public remote.

## 2. `git filter-repo --replace-text` (every remaining branch and tag)

```
git filter-repo --force --replace-text /path/to/private/expressions.txt \
  --path-rename <OLD_DEPLOY_TREE>:deploy/example \
  --path-rename <OLD_CHART_DIR>:deploy/k8s/helm/sandboxes \
  --path-rename <OLD_HELPER_JS>:scripts/deploy-server.mjs \
  --path-rename <OLD_HELPER_TEST>:scripts/deploy-server.test.mjs \
  --path-rename <OLD_NP_YAML>:deploy/k8s/sandboxes/adapters/azure/networkpolicy-ingress.yaml
```

Puis, dans une passe séparée sur le même clone, retirer le fichier
`.trivyignore` de tout l'historique (toutes ses versions passées, sur chaque
ref réécrit) :

```
git filter-repo --force --invert-paths --path .trivyignore
```

Précondition : aucune réécriture tant que des entrées `.trivyignore` sont
encore sur `main`. Les entrées passent d'abord dans un fichier privé injecté
par la CI, dans une PR séparée fusionnée **avant** la réécriture, et le
contrôle Trivy (build et publication) doit être vérifié avec ce fichier privé
seul. Dry-run local (rien poussé) : 4 commits touchaient `.trivyignore` avant
la passe, 0 commit et 0 blob après.

Cette passe ne touche que les refs réécrits (`refs/heads/*`, `refs/tags/*`).
Les blobs `.trivyignore` encore joignables par `refs/pull/*` (dont
`refs/pull/444/*` et `refs/pull/452/head`) ne disparaissent qu'avec la purge
du Support GitHub (étape 4).

Classes only (live hostnames are **not** written here):

```
literal:<CHART_OLD>==>sandboxes
literal:<SYSNS_OLD>==>sandbox-system
literal:<DEPLOY_HELPER>==>deploy-server
literal:<NP_OLD>==>networkpolicy-ingress
regex:\b<OLD_DEPLOY_TREE>\b==>deploy/example
literal:<AKS_CLUSTER>==><AKS_CLUSTER>
literal:<PREVIEW_DOMAIN>==><PREVIEW_DOMAIN>
regex:<CLIENT_ZONE_HOST_CLASS>==><HOST_FQDN>
regex:<CLIENT_CLOUD_HOST_CLASS>==><HOST_FQDN>
regex:<AKS_FQDN_CLASS>==><AKS_FQDN>
regex:<ACR_HOST_CLASS>==><ACR_NAME>.example
literal:<VAULT_A>==><KEY_VAULT>
literal:<VAULT_B>==><KEY_VAULT>
regex:<RESOURCE_GROUP_CLASS>==><RESOURCE_GROUP>
regex:@<CLIENT_ZONE>==>@example.com
literal:<PRIVATE_REPO_NAME>==><PRIVATE_REPO>
literal:<D1_DATABASE_ID_BROKER>==>00000000-0000-0000-0000-000000000000
literal:<D1_DATABASE_ID_CONTROL_PLANE>==>00000000-0000-0000-0000-000000000000
```

Inventaire ajouté après la fusion de `main` dans #437 (valeurs réelles
seulement dans le fichier privé d'expressions, jamais ici) :

- les chaînes `<PRIVATE_REPO_NAME>` restantes (nom du dépôt privé) dans les specs
  de `docs/superpowers/`, `server/routes/account.ts` et
  `src/components/PulsatrixMark.tsx` → `<PRIVATE_REPO_NAME>`;
- le `database_id` wrangler (D1) présent sur `main`, dans
  `cloudflare/control-plane/wrangler.jsonc` → `<D1_DATABASE_ID_CONTROL_PLANE>`,
  remplacé par l'UUID tout à zéro que le README du control-plane documente déjà.
- les identifiants de vulnérabilités ouvertes exposés par #452 (corps,
  commentaires, messages de commit, fichiers) et par `.trivyignore` (ainsi que
  les tests et le code de `main` qui les citent) : une classe
  `<OPEN_VULN_ID>` dans le fichier de remplacements hors dépôt, appliquée à
  tous les commits concernés de la réécriture. Les valeurs ne figurent que
  dans l'inventaire privé. Le contrôle `.trivyignore` doit garder une source
  hors dépôt public après la réécriture.
- les commits de #452 : la PR est fermée et sa branche supprimée, donc ses
  commits n'arriveront pas sur `main` ; ils restent joignables seulement par
  `refs/pull/452/head`. L'inventaire de la réécriture les couvre quand même
  (vérification sur ce ref avant la demande au Support) et la purge Support
  de l'étape 4 les retire.

Do **not** rewrite official product contact addresses, product image names, or
`SAGAX_*` environment variables.

## 3. Tags and GitHub Releases

`git filter-repo` on the cleaned `--mirror` rewrites `refs/tags/*`. GitHub
Releases stay attached to the tag *name* and may still cite the old SHA.
After an authorized tag force-update: retarget every release, re-upload
assets if needed, do not leave a Release pointing at a pre-rewrite commit.

## 4. GitHub keeps `refs/pull/*` — ask Support to purge

Even if the operator deletes pull refs in the private mirror, GitHub still
holds `refs/pull/<n>/head` and `merge` on the server. After branches and
tags are rewritten, every existing PR still holds the old commits.

File a GitHub Support request to purge `refs/pull/*` and run GC.

**Name `refs/pull/444` explicitly in that request.** PR #444's `head` and
`merge` refs keep commit `1b3bbe5e` (commit à purger) even if
`cursor/docker-image-cves-5d72` is rewritten or deleted. Ask Support to
delete at least:

- `refs/pull/444/head`
- `refs/pull/444/merge`
- `refs/pull/452/head` (pas de `refs/pull/452/merge` : la PR est fermée sans
  ref de fusion)

and then to purge unreachable objects. A generic `refs/pull/*` purge covers
the rest of the open and closed pull requests; 444 and 452 must not be omitted if
Support asks for a short list.

## 5. Freeze / force-push sequence (operator only; not this PR)

1. Nova warns the maintainer. Do not start without that.
2. Confirm the private mirror exists, pull refs were dropped, and
   `for-each-ref` plus the release list were saved. Confirm
   `cursor/docker-image-cves-5d72` (or a recorded absence plus the Support
   purge of `refs/pull/444`) is in that list.
3. Disable merge queues and branch protection bypass for everyone except the
   operator.
4. Rewrite on a disposable clone of the cleaned mirror.
5. Verify the rewritten tip of `main` still builds and that grep of every
   class over `git rev-list --all` is empty, including the rewritten
   `cursor/docker-image-cves-5d72` tip.
6. Force-push **all** rewritten public refs in one window (`--mirror` to the
   public remote), including tags, then restore branch protection.
7. Retarget GitHub Releases.
8. Ask GitHub Support to purge `refs/pull/*`, naming `refs/pull/444`.
9. Rotate any credential that ever appeared in history.
10. This PR must not run that force-push.

## 6. Open PRs to rebase afterwards

Every open PR whose commits were rewritten needs a rebase onto the new
`main`. PRs whose only unique commits are identifier-only (including #437)
can close after the rewrite. PR #444 needs a rebase (or a close and a new
branch) because `1b3bbe5e` is in its unique history. Announce the SHA
cut-over so local clones `git fetch` + reset rather than merge the old
history back in.

## 7. Purge de l'historique d'édition des PR

GitHub conserve chaque révision du corps d'une PR et de ses commentaires
(menu « Edited »). La réécriture git ne les touche pas. Aucune valeur n'est
citée ici ; la liste de référence est l'inventaire privé de l'étape 2.

a. **#437** : les révisions du corps qui contiennent l'ancien nom du dépôt
   privé.
b. **#444** : les révisions du corps qui contiennent l'inventaire de
   vulnérabilités (déjà signalées), plus les commentaires concernés de #434.
c. **Autres PR et commentaires du dépôt** : vérifier les corps, les
   commentaires et les revues de toutes les autres PR pour toute valeur de
   l'inventaire, et supprimer les révisions trouvées.
d. **#452** : les révisions du corps qui contiennent des identifiants de
   vulnérabilités ouvertes (le corps actuel est vide, l'historique
   « Edited » les garde), plus tout commentaire concerné.
e. **#457** : les révisions antérieures du corps de #457.

Responsable, pour a, b, c, d et e : un administrateur du dépôt supprime chaque révision via l'interface « Edited » →
supprimer la révision. Si une révision ne peut pas être supprimée ou reste en
cache, la demande va au Support GitHub, dans le même ticket que la purge des
`refs/pull/*` (étape 4).

## Checklist finale

- [ ] Précondition : PR de migration des entrées `.trivyignore` vers le fichier privé injecté par la CI fusionnée, plus aucune entrée sur `main`, contrôle Trivy (build et publication) vérifié avec le fichier privé seul
- [ ] `.trivyignore` retiré de tout l'historique réécrit (`--invert-paths --path .trivyignore`), vérifié : aucun commit ni blob restant
- [ ] Historique d'édition des corps et commentaires de PR purgé (#437, #444, #434, #452, #457, autres vérifiées)
- [ ] Identifiants de vulnérabilités ouvertes : révisions de #452 purgées, `refs/pull/452/head` dans la demande au Support, les autres commits concernés couverts par le fichier de remplacements hors dépôt, `.trivyignore` retiré par la passe `--invert-paths --path .trivyignore` (étape 2), ses blobs joignables par `refs/pull/*` purgés par le Support GitHub (étape 4)

Do not execute any of the above from an agent session on #437.
