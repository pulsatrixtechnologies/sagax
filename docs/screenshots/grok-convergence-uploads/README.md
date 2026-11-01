These captures show the real ComposerAttachments component with synthetic
file names and upload state, through src/gallery/attachment-uploads.html.
They do not contain user app data and do not prove Grok runtime parity.

Before uses the component at 955f1c306, saved under ignored scratch with
only its relative imports redirected back to src/components. After uses
the current component. Both receive the same invented pending/failed files.
Desktop is 1280 x 720; mobile is 390 x 844; locale is French.

The capture run also focused Retry upload and pressed Enter, checked that
it started progress, then focused Remove file and pressed Enter, checked
that the chip disappeared, and checked for horizontal overflow at both widths.
Chrome ran headless with an isolated Playwright context.

Files: desktop-before.png, desktop-after.png, mobile-before.png,
mobile-after.png. Physical touch/device validation is still pending.
