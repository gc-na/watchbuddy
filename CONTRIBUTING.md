# Contributing

Thanks for helping WatchBuddy get better.

## Good first contributions

- Add transcript adapters for more video platforms.
- Improve direct answers for short factual questions.
- Add provider support.
- Improve microphone, speech recognition, or text-to-speech behavior across browsers.
- Polish themes and accessibility states.
- Report YouTube transcript DOM changes with a video URL and timestamp.
- Improve privacy and local-first behavior.

## Development

No build step is required.

```bash
npm run validate
```

Load the repository folder in `chrome://extensions` with Developer mode enabled.

Useful files:

- `src/content.js` for platform/video/transcript capture
- `src/sidepanel.js` for chat and provider behavior
- `src/voice.js` for microphone and spoken answers
- `src/theme.js` for theme behavior

## Pull requests

Please include:

- What changed
- Why it changed
- How you validated it
- A video URL and timestamp if the change affects transcript accuracy

Keep changes focused. Transcript accuracy regressions are easy to introduce, so add cases to `scripts/validate.js` when possible.
