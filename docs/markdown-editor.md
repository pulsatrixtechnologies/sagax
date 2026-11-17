# Markdown editor

Every place in the desktop app where a person writes markdown uses the same
editor, `src/components/markdown/MarkdownEditor.tsx`. The text stays plain
markdown: what is saved is exactly what was typed, through the same handler
and the same request as the plain text box it replaced.

## What it does

- **Live formatting while typing.** Headings are sized, bold is bold, italic
  is italic, inline code and code blocks are monospace on a tinted band,
  quotes carry a bar, tables are monospace, links are coloured, and a checked
  task (`- [x]`) is struck through. The markdown marks stay visible and dim.
- **Write, Preview, Side by side.** Preview renders with `ChatMarkdown`, the
  renderer of chat messages, so it shows what the bot's markdown looks like
  in the app. Side by side is in Advanced mode only and is remembered.
- **Toolbar.** Bold, italic, heading, bulleted list, numbered list,
  checklist, quote, code, link, table, divider line and Format. In Simple
  mode the toolbar keeps bold, italic, bullets, checklist and link; the rest
  is behind the "More" button.
- **Lists.** Enter continues a list (next number, an empty box for a task,
  `>` in a quote); Enter on an empty item ends the list or moves a nested
  item out. Tab nests a list item under the one above, Shift+Tab moves it
  out. Outside a list, Tab moves focus as usual.
- **Auto-pairs.** `(`, `[` and backticks close themselves; `*` and `_` do
  where emphasis can start (never at the start of a line, where `*` is a
  bullet, and never inside a word, so `snake_case` types normally). Typed
  over a selection, they wrap it. Backspace removes an empty pair.
- **Paste.** A URL pasted over selected text makes a link. Tab-separated
  rows (copied from a spreadsheet) become a table, first row as header.
- **Format.** Tidies spacing without changing what renders: one blank line
  around headings and code blocks and before a list that follows a
  paragraph, `-` for every bullet, `# Title` spacing, no trailing spaces
  (a two-space line break inside a paragraph stays), no runs of blank
  lines. Code blocks and front matter are left byte for byte.
- **Counts.** Words and characters in the status line, and the cap when the
  field has one (`maxLength`). Fields with their own counter (SOUL.md bytes,
  team instructions) keep it there.
- **Task boxes.** Clicking `[ ]` or `[x]` in the editor toggles it.

## Shortcuts

Mac shown first; on Windows and Linux use Ctrl for Cmd and Alt for Option.

| Action | Mac | Windows, Linux |
|---|---|---|
| Bold | Cmd+B | Ctrl+B |
| Italic | Cmd+I | Ctrl+I |
| Link | Cmd+K | Ctrl+K |
| Inline code (code block for several lines) | Cmd+E | Ctrl+E |
| Heading 1, 2, 3 (again removes it) | Cmd+Option+1, 2, 3 | Ctrl+Alt+1, 2, 3 |
| Numbered list | Cmd+Shift+7 | Ctrl+Shift+7 |
| Bulleted list | Cmd+Shift+8 | Ctrl+Shift+8 |
| Checklist | Cmd+Shift+9 | Ctrl+Shift+9 |
| Quote | Cmd+Shift+. | Ctrl+Shift+. |
| Format | Shift+Option+F | Shift+Alt+F |
| Nest or un-nest a list item | Tab, Shift+Tab | Tab, Shift+Tab |
| Undo, redo | Cmd+Z, Cmd+Shift+Z | Ctrl+Z, Ctrl+Y |
| Leave the editor | Escape | Escape |

Cmd+K inside the editor makes a link; outside it still opens the command
palette.

## Accessibility

The toolbar is a WAI-ARIA toolbar: one Tab stop, arrow keys, Home and End
move between buttons, and every button has a label and its shortcut
(`aria-keyshortcuts`). The text area is labelled by the field's own label.
Escape leaves the editor and puts focus on its frame (focus ring shown), so
the next Tab reaches the next control. Colours come from the app's tokens,
so dark, light and every skin apply.

## Where it is used

| Field | Component |
|---|---|
| Standing instructions (SOUL.md), Advanced and Simple bot panel, New bot | `SoulField.tsx` |
| Bot memory: MEMORY.md and topic files (daily logs read-only) | `bot-settings/MemorySection.tsx` (`MemoryEditorDialog`) |
| New bot draft memory | `NewBotDialog.tsx` (`DraftMemory`) |
| Skill instructions (SKILL.md body) in the skills library | `plugins/SkillPage.tsx` |
| Group instructions | `GroupPanel.tsx` |
| Group memory | `GroupMemoryTab.tsx` |
| Team instructions (section context) | `TeamMapPage.tsx` (`SectionContextDialog`) |
| Routine instructions, full editor and quick create | `RoutineCalendarPage.tsx` (`EventEditor`, `QuickComposer`) |
| Trigger instructions | `TriggersPanel.tsx` |
| Webhook default instructions | `WebhooksPanel.tsx` (`WebhookEditor`) |

Plain text boxes stay where the text is not markdown: a bot's one-line
description, image prompts, JSON imports, shell commands, tool and people
lists, environment variables, team memory entries (single-line facts),
share notes, chat composers and message edits, and the room's quick
bulletin edit in the chat header (the full editor is in the group panel).

## How it loads

`MarkdownEditor` is in the main bundle and is small. CodeMirror lives in
`MarkdownEditorCore.tsx`, a separate chunk loaded the first time an editor
mounts. Until it arrives (or if it cannot load), a plain textarea with the
same value, label and handlers stands in, so typing is never blocked.
Nothing in the editor reaches the network.

Dependencies: `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`, `@codemirror/language`, `@lezer/markdown` and
`@lezer/highlight` (MIT). `@codemirror/lang-markdown` is not used: it pulls
the HTML, CSS and JavaScript languages in for embedded code; the markdown
parser is wired directly instead.

## Using it in a new field

```tsx
<MarkdownEditor
  value={text}
  onChange={setText}
  onBlur={save}              // optional
  ariaLabelledBy="my-label"  // or ariaLabel
  placeholder="..."
  minHeight={200}
  maxLength={8000}           // optional cap
  footer={<span>hint</span>} // optional left side of the status line
  dataField="my-field"
/>
```

The text edits are pure functions in `markdown-edits.ts`
(`markdown-edits.test.ts`); the component and every field above have render
tests (`MarkdownEditor.test.ts`, `MarkdownEditor.surfaces.test.ts`).
