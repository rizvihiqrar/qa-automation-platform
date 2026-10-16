# Eval run: claude-code-2026-10-16

## How this run was made

- **Generator:** Claude (Opus 5.5) in a Claude Code session, not the paid API pipeline in `src/generate.js`. It followed the same rules as the generator's prompt (`src/prompts/testPrompt.js`) and used the 10 feature descriptions in `examples/input/`.
- **One pass:** each spec was written once, then scored as written. The specs in this folder are the unedited output.
- **Scoring:** `npm run eval -- --score eval/runs/claude-code-2026-10-16`. Review rules, then one Playwright run against the live Sauce Demo site with **no retries**.
- **Human fixes:** recorded in `FIXES.md`. The specs here are not changed by those fixes.

## Known bias

Earlier in the same session the site's pages and selectors had been explored to verify the feature descriptions. A fresh API call only sees the prompt, which lists a subset of the selectors. This run is therefore a best case for selector knowledge; it still measures timing, assertion and logic mistakes fairly.

## Files

| File | Contents |
|---|---|
| `feature-*.spec.js` | The 10 generated specs, unedited |
| `REPORT.md` | Scores |
| `results.json` | Scores as data |
| `FIXES.md` | What a person had to change |
| `playwright-results.json` | Raw Playwright report |
