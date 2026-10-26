---
name: data-dashboards
description: "Build a fast, good-looking data dashboard: as an artifact the person keeps in Sagax, or as a link to share with propose_page. Use when the person asks for a dashboard, charts or KPIs on a page, or a data page to keep up to date."
---

# Data dashboards

## Pick the right home

| The person wants | Build |
|---|---|
| A quick answer or one chart | No page. Use the Data tools (`data_sql`, then `data_show`) or a markdown table. |
| A dashboard they keep, pin or watch in Sagax | A `save_artifact`: the self-contained dashboard page. Add `source` and `interval_seconds` so it refreshes itself. |
| A link to share with other people | Build the same page, then `propose_page` it (only when they ask to share). |
| "Keep it up to date" | A saved artifact with a `source` (a read tool such as `workspace_read` of a JSON file you keep, or a read-only command that prints JSON), so Sagax re-runs it on the interval with no turn of yours. |

A proposed page is public: never put secrets, personal details, or rows the person did not ask to share in it.

## Start from the template

`dashboard.html` sits next to this guide, in the folder named by this skill's `root`. It is tested in the artifact
sandbox, in light and dark, at phone and desktop widths. Copy it as your artifact's `html` and change only what the
data needs:

1. `CONFIG`: `source`, `updated` (ISO time the data was refreshed), `currency`.
2. `QUERIES` and the `render*` functions: your columns and your questions. The sample has `date`, `region`, `category`, `units`, `revenue`.
3. Headings, notes and KPI labels in the HTML.
4. Paste your rows as JSON between the `embedded-data` tags, or leave them out and feed the artifact through its `source`.

Keep the rest: the colour tokens, the inline SVG charts, the `Intl` formatting, the loading and error states, the
aria labels and the "Show the numbers" tables. Cut a card rather than adding a fifth chart.

## The sandbox

The artifact runs with no network at all: no `fetch`, no cookies or storage, and no scripts, styles, fonts or images
from any URL. Everything is inline. That is why the template draws its charts with hand-written SVG instead of a
chart library. Do not add a `<script src>` or a `<link href>`: the page's own policy blocks it and the dashboard
stays blank.

The page reads its data two ways, in this order:

- `window.sagax.data` is the latest JSON from the artifact's `source`, and `window.sagax.onData(fn)` calls `fn` with
  each refresh. A refreshing dashboard reads these.
- When there is no source, it reads the JSON embedded between the `embedded-data` tags.

## Data

- **Aggregate first.** Ship the smallest table that answers the questions: one row per day and dimension, not raw events. Do the heavy work with `data_sql`, then embed or export the slice.
- **Size.** An artifact's page is at most 200 KB including the template (about 20 KB), so embed at most about 150 KB of rows; `data_export` a larger slice and keep only the aggregate.
- **Types.** Dates as `YYYY-MM-DD`. Keep sums and counts as plain numbers.
- Check one or two numbers on the page against a direct `data_sql` query before you show it.

## Design

**Charts**
- One question per chart. Make the heading the question ("Which regions sell the most?") and the note under it the answer, computed from the data.
- Pick the form by the job: compare categories with a bar (horizontal and sorted when labels are long); show change over time with a line. A single number is a KPI tile, not a chart. Many categories belong in a table.
- Never: 3D, two y-axes, pies with more than 3 slices, a number on every point.
- Bars start at zero. Do not cut an axis to make a change look bigger.
- Emphasis beats colour: one accent for what matters, grey for the rest.

**Colour**
- Use the theme tokens: `--color-accent` for the one thing that matters, `--color-ink` and `--color-ink-secondary` for text, `--color-hairline` for grid lines, `--color-success` and `--color-danger` only for good and bad, always with an arrow and words.
- Give each category a fixed colour so filtering never repaints the survivors. Fold anything past six into "Other".

**Layout and type**
- Order: title and filter, then 3 to 5 KPI tiles, the main chart full width, one supporting chart, a detail table, and the source line.
- Space on a 4, 8, 12, 16, 24 px scale; hairline grid lines; whitespace separates cards.
- Use `--font-sans`. Tabular numbers in tables and axes.
- Format every number and date with `Intl`: compact for KPIs and axes, full in tables.
- Say where the data came from and when it was refreshed, at the bottom.

**Access**
- One filter, above everything; every KPI, chart and table follows it.
- Each chart has an `aria-label` that states what it shows and the takeaway, and a table that holds the same numbers.
- It must work at 360 px wide: one column, nothing scrolls sideways except a wide table in its own box.
- Show a loading line at start and a plain error if the data is missing.

## Before you hand it over

- Look at it light and dark, wide and narrow: labels must not collide or clip.
- Aggregate in SQL; never chart more than about 2000 marks.
- For a shared page, give the link and say how it stays current.
