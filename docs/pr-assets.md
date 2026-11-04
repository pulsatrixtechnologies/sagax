# PR evidence media

Visual proof for pull requests (before/after screenshots, short clips, GIFs)
does not live under tracked `docs/` on product branches unless a tracked file
cites that media by path or by basename.

## Where PR evidence lives

- **Orphan branch `pr-assets`** (same relative paths, for example
  `docs/screenshots/composer-one-line.webp`): durable home for PR visual
  proofs that a PR body links by a **branch-name** ref. Product branches
  (`main`, `feat/next-*`, release lines) never carry those files again.
- **In the PR body**: attach images or short videos on the GitHub pull request
  itself when you do not need a stable raw URL. Prefer MP4 or WebP over large
  GIFs.
- **Tracked `docs/screenshots/` and `docs/verification/`**: only media that a
  tracked file still references (a markdown path, a capture script, AGENTS
  notes, a plan). Keep those; they document shipped behavior.

## How to push a proof to `pr-assets`

```sh
git fetch origin pr-assets
git worktree add /tmp/sagax-pr-assets pr-assets
# copy the media to the same docs/… path the PR will link
git -C /tmp/sagax-pr-assets add docs/screenshots/example.webp
git -C /tmp/sagax-pr-assets commit -m "pr-assets: add example proof"
git -C /tmp/sagax-pr-assets push origin pr-assets
```

Point the PR body at one of:

- `https://raw.githubusercontent.com/pulsatrixtechnologies/sagax/pr-assets/docs/screenshots/example.webp`
- `https://github.com/pulsatrixtechnologies/sagax/blob/pr-assets/docs/screenshots/example.webp?raw=true`

A link pinned to a **commit SHA** already keeps working after the file leaves
a product branch; it does not need a copy on `pr-assets`.

## Formats

Prefer **MP4** or **WebP** over GIF. The merge guard refuses a tracked GIF
under `docs/` larger than 2 MiB (`scripts/testing/docs-media.guard.test.ts`).

## Orphan media (issue #1386)

Media under `docs/` that no tracked file referenced were removed from product
branches. A file counts as referenced when a tracked text file names its path,
its basename, or one of its own folders (a capture script's reference set such
as `docs/screenshots/shapes` is cited by its folder); the shared containers
(`docs/screenshots`, `docs/verification/evidence`) do not count. Branch-name PR links were rewritten (or are rewritten with
`scripts/repo/rewrite-pr-asset-links.mjs`) to the `pr-assets` branch. SHA-pinned
links stay as they are.

To list new orphans:

```sh
node scripts/repo/docs-media-orphans.mjs
```

Do not put third-party app captures or real personal install data (hostnames,
names, emails) into the repo. Committed captures must come from galleries or
fixtures with synthetic data only.

## Related

- UI screenshot expectation: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Verification captures that stay in-tree when cited:
  [verification/README.md](verification/README.md)
- Orphan scanner: `scripts/repo/docs-media-orphans.mjs`
- PR body rewrite: `scripts/repo/rewrite-pr-asset-links.mjs`
