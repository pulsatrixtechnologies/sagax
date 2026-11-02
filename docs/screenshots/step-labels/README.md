# Step labels (V10)

Headless captures of a synthetic run sheet and routine-run exchange:

- `before-*`: full server paths and UUIDs on `runCommand` rows; tool searches listed one by one on the run sheet.
- `after-*`: short targets (`ls sagax-plugins`, `python check_health.py`); finished tool searches folded like `ActivityRun`.

Gallery: `src/gallery/step-labels.html`. Capture: `node scripts/capture-step-labels.mjs [--prefix before|after]`.

Synthetic data only. No real hostnames, names, or install paths.
