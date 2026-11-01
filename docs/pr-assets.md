# PR evidence media

Visual proof for pull requests (before/after screenshots, short clips, GIFs)
does not live under tracked `docs/` unless a tracked file cites that media by
path or by a specific directory name.

## Where PR evidence lives

- **In the PR body**: attach images or short videos on the GitHub pull request
  itself. Prefer MP4 or WebP over large GIFs.
- **Local `pr-assets/`** (gitignored): optional working copy on a developer
  machine for drafts and comparisons. The folder mirrors former `docs/`
  relative paths (for example `pr-assets/screenshots/composer-one-line.gif`).
  It is never committed.
- **Tracked `docs/screenshots/` and `docs/verification/`**: only media that a
  tracked file still references (a markdown path, a capture script, AGENTS
  notes, a plan). Keep those; they document shipped behavior.

## Orphan media (issue #1386)

Media under `docs/` that no tracked file referenced were removed from the
index and left on disk under `pr-assets/` when the move ran. Git history still
holds the blobs; they are simply no longer part of the tree going forward.

To find new orphans later:

```sh
# List tracked docs media whose basename and path never appear in tracked text.
# Keep every file a tracked document or script still names.
```

Do not put third-party app captures or real personal install data (hostnames,
names, emails) into the repo. Committed captures must come from galleries or
fixtures with synthetic data only.

## Related

- UI screenshot expectation: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Verification captures that stay in-tree when cited:
  [verification/README.md](verification/README.md)
