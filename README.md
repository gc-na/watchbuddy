# WatchBuddy

AI co-watching for YouTube, courses, keynotes, streaming videos, and the long internet rabbit holes we all pretend are "research."

WatchBuddy is a Chrome extension that reads the current video timestamp, transcript, captions, page metadata, and recent chat so you can ask questions while watching.

It is built for moments like:

- "What did they mean by that?"
- "Where is this?"
- "How much did they say it costs?"
- "Quiz me on the last few minutes."
- "Explain this lecture part like I am new to it."
- "Talk back to me while I watch this."

## Highlights

- Chrome Manifest V3 extension
- Side panel chat UI
- `Alt+W` shortcut
- Press `Enter` to send, `Shift+Enter` for a newline
- Voice question input with microphone permission handling
- Optional spoken answers with browser text-to-speech
- Light, dark, and system theme modes
- YouTube transcript capture with current timestamp awareness
- Netflix, Udemy, Coursera, and Bilibili content-script targets
- User-initiated fallback injection for other video pages
- Direct answers for short factual transcript questions
- Prompt budgeting for long videos
- Chrome built-in AI support for a zero-key path
- OpenRouter, Gemini, Groq, OpenAI, and Ollama provider support
- Local validation suite for transcript grounding regressions
- No build step
- MIT licensed and built to be forked

## Why This Exists

Long videos already contain useful structure: timestamps, captions, transcripts, descriptions, titles, and page context. WatchBuddy turns that into a conversation without forcing you to leave the video.

The goal is not just "chat with a page." The goal is a small companion that understands where you are in the video.

## Supported Providers

| Provider | Default model | API key |
| --- | --- | --- |
| Chrome built-in AI | Gemini Nano | No |
| OpenRouter | `openrouter/free` | Yes |
| Google Gemini | `gemini-2.5-flash` | Yes |
| Groq | `llama-3.3-70b-versatile` | Yes |
| OpenAI | `gpt-5.4-mini` | Yes |
| Ollama | `llama3.2` | No |

Chrome built-in AI is the best zero-key path when available. Hosted providers use bring-your-own-key so the extension never ships a shared API key.

## Platform Support

WatchBuddy has explicit content-script support for:

- YouTube
- Netflix
- Udemy
- Coursera
- Bilibili

It also tries a user-initiated fallback on the active tab, so contributors can experiment with other video sites without adding broad always-on host access. Accuracy depends on what the page exposes: transcripts and captions are best, page text is weaker, and raw audio/video pixels are not interpreted yet.

## Install Locally

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `watchbuddy` folder.
6. Open a supported video page.
7. Click WatchBuddy or press `Alt+W`.
8. Pick a provider in settings.

For voice:

- Click the microphone once and allow microphone access when Chrome asks.
- Turn on "Speak answers out loud" in settings if you want every answer spoken.
- If you asked by microphone, WatchBuddy speaks that answer even if the global voice setting is off.

For Ollama:

```bash
ollama pull llama3.2
ollama serve
```

## Validation

```bash
npm run validate
npm run smoke:chrome
```

The validation script checks:

- extension JavaScript syntax
- `manifest.json`
- Korean follow-up grounding
- direct transcript answers
- weak-answer fallback behavior
- long-video prompt budgeting
- voice/theme helper syntax

The Chrome smoke test launches an isolated Chrome profile, loads the unpacked extension, opens the side panel page, checks voice/theme helpers, verifies dark mode, and confirms `Enter` submits the chat box.

Note: Google Chrome 137+ removed command-line unpacked extension loading for security reasons. `npm run smoke:chrome` runs with Chrome for Testing or Chromium when available, and otherwise prints a skip message. You can also set `CHROME_PATH` to a compatible browser.

## Package

```bash
npm run package
```

This creates `watchbuddy-mvp.zip` next to the repository folder.

## Publish To GitHub

If you have the GitHub CLI installed:

```bash
scripts/publish-github.sh watchbuddy public
```

That script validates, packages, creates a public GitHub repository if needed, pushes `main`, and opens the repository page.

## Project Layout

- `src/content.js` captures video, transcript, metadata, and timestamp context.
- `src/sidepanel.js` owns chat, provider calls, answer grounding, and current-tab injection.
- `src/voice.js` owns speech recognition permission flow and spoken answers.
- `src/theme.js` owns theme application.
- `scripts/validate.js` keeps transcript grounding regressions from sneaking back in.

## Accuracy Philosophy

WatchBuddy uses two layers:

1. Direct transcript extraction for factual questions such as prices, places, and "what did they say?"
2. AI provider calls for explanation, tutoring, summarization, and conversational help.

This keeps short factual answers grounded instead of asking a model to guess from a huge transcript blob.

## Privacy

WatchBuddy runs in your browser. It sends captured video context and your question to the selected provider only when you ask.

API keys are stored with `chrome.storage.sync`. Do not use a shared API key in a published extension.

## Roadmap

- More robust YouTube transcript adapters
- Better Netflix, Udemy, Coursera, and Bilibili adapters
- Adapter registry for community-maintained video platforms
- Streaming responses
- Local per-video memory
- OCR for visible video text
- Audio/music identification integration
- Provider-specific model presets
- Test fixture corpus for transcript accuracy
- Chrome Web Store publishing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Good first issue idea: pick one video platform, capture the current timestamp plus nearby transcript/caption text, and add a validation case with a URL, timestamp, and expected answer shape.

## License

MIT
