# PR visual proofs (`pr-assets/shared`)

This is an **orphan branch**. It holds visual proof media that pull request
bodies link by a **branch-name** ref (`main`, `feat/…`, …). Product branches
(`main`, `feat/next-*`, release lines) never carry these files under `docs/`.

## Rule

- PR screenshots, GIFs and short clips that exist only as PR evidence live here.
- Keep the same relative paths the PR originally used (`docs/screenshots/…`,
  `docs/verification/…`, …) so a URL rewrite only changes the ref.
- Prefer MP4 or WebP over large GIFs.
- Links pinned to a commit SHA already keep working after the file leaves
  product branches; they do not need a copy here.
- Do not put third-party app captures or real personal install data
  (hostnames, names, emails) on this branch. Synthetic gallery or fixture
  captures only.

## How to add a proof

From a throwaway worktree on this branch:

```sh
git fetch origin pr-assets/shared
git worktree add /tmp/sagax-pr-assets pr-assets/shared
# copy the media to the same docs/… path, commit, push
git -C /tmp/sagax-pr-assets add docs/screenshots/example.webp
git -C /tmp/sagax-pr-assets commit -m "pr-assets: add example proof"
git -C /tmp/sagax-pr-assets push origin pr-assets/shared
```

Point the PR body at:

`https://raw.githubusercontent.com/pulsatrixtechnologies/sagax/pr-assets/shared/docs/screenshots/example.webp`

or the `blob/pr-assets/shared/…?raw=true` form.

## Related

- Product-branch policy: `docs/pr-assets.md` on any product branch
- Orphan scanner: `scripts/repo/docs-media-orphans.mjs`
- Link rewrite (dry-run by default): `scripts/repo/rewrite-pr-asset-links.mjs`
