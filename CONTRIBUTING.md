# Contributing

Thanks for helping WatchBuddy get better.

## Good first contributions

- Add transcript adapters for more video platforms.
- Improve direct answers for short factual questions.
- Add provider support.
- Report YouTube transcript DOM changes with a video URL and timestamp.
- Improve privacy and local-first behavior.

## Development

No build step is required.

```bash
npm run validate
```

Load the repository folder in `chrome://extensions` with Developer mode enabled.

## Pull requests

Please include:

- What changed
- Why it changed
- How you validated it
- A video URL and timestamp if the change affects transcript accuracy

Keep changes focused. Transcript accuracy regressions are easy to introduce, so add cases to `scripts/validate.js` when possible.
