# models.dev

`server/model-catalog/models-dev.snapshot.json` is a trimmed copy of the
models.dev catalog (`https://models.dev/api.json`), MIT License, Copyright (c)
2025 models.dev. The full license text is in [LICENSE](LICENSE) and inside the
snapshot itself (`source.licenseText`).

- Source: https://github.com/anomalyco/models.dev at commit
  `1bf866e6a1cbbf923259ad1d76b50e4eac53d111` (2026-11-10T01:02:58Z), the
  head of the repository when `https://models.dev/api.json` was downloaded
  for this build (2026-11-10, refresh for Claude Fable 5.2).
- Built with `node scripts/build-model-catalog.mjs --input api.json --commit
  <sha> --updated-at <commit time>`; `--check` verifies the committed file.
- Trimmed to the provider index and current, tool-calling, text-input models.
  Any provider or model whose strings contain `{` or `}` is left out, because
  OpenCode expands `{env:…}` and `{file:…}` anywhere in its configuration.
