# Page window fit-to-content Implementation Plan

> **For agentic workers:** Native execution in this worktree (JC delegated #2051).

**Goal:** Detached page windows auto-size to content, remember a hand resize, and avoid a visual jump.

**Architecture:** Page windows get a narrow preload; the renderer measures via `sagax-page-size` + ResizeObserver and calls `fitContent`; main clamps to min/work area, delays show, and stops auto-fit once `personSized` is set in the existing places store.

**Tech Stack:** Electron IPC/preload, React, Vitest (node + happy-dom).

**Spec:** `docs/superpowers/specs/2026-11-05-page-window-fit-content-design.md`

## Global Constraints

- Quebec French / no em or en dashes in docs.
- Page windows only (`page:` prefix); regular artifacts stay without preload.
- Synthetic data in tests only.

## Review Focus

- Person resize vs programmatic fit must not flip `personSized` incorrectly.
- Clamping must keep the window inside the current display work area.
- Re-open with `personSized` must skip auto-fit and show immediately.
- Missing size message must still show within the timeout.
- Side panel open while still auto-fitting should refit.

---

### Task 1: Pure fit helpers

**Files:**
- Create: `src/lib/page-window-fit.ts`
- Test: `src/lib/page-window-fit.test.ts`

**Interfaces:**
- Produces: `PAGE_WINDOW_FIT_MIN`, `PAGE_WINDOW_FIT_DEFAULT_WIDTH`, `clampPageWindowSize(size, workArea)`, `pageWindowOuterSize({ contentHeight, width?, chromeHeight? })`

- [ ] Failing tests for clamp and outer size
- [ ] Implement helpers
- [ ] Pass tests

### Task 2: Electron fit-content + personSized

**Files:**
- Create: `electron/artifact-window-preload.cjs`
- Modify: `electron/artifact-window.mjs`
- Modify: `electron/main.mjs` (pass preload path)
- Test: `electron/artifact-window.test.mjs`

**Interfaces:**
- Produces: `artifact-window:fit-content` from the page window sender; places `{ bounds, maximized, personSized? }`; page windows use preload and delay show

- [ ] Failing electron tests
- [ ] Implement
- [ ] Pass tests

### Task 3: Renderer measure + fit loop

**Files:**
- Modify: `src/components/artifacts/ArtifactStandaloneWindow.tsx`
- Modify: `src/types/ogb.d.ts` (or window typing for `artifactWindowSelf`)
- Test: `src/lib/page-window-fit.test.ts` (hook helpers) and/or `src/components/artifacts/ArtifactStandaloneWindow.dom.test.ts`

- [ ] Failing component/helper tests for measure → fitContent
- [ ] Implement observe + apply iframe height + call bridge
- [ ] Pass tests

### Task 4: Docs, RESULT, commit

- [ ] Update AGENTS.md note if page-windows section needs one line
- [ ] RESULT.md untracked
- [ ] Focused commit with Co-Authored-By
