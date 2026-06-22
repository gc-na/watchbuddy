# WatchBuddy

WatchBuddy is a Chrome extension that lets you talk with an AI buddy while watching videos.

It reads the current video page, nearby captions/transcripts when available, and your current playback timestamp. Then it answers questions like a study buddy, event curator, or co-watching friend.

## Why

Videos already know a lot about what you are watching: timestamps, captions, transcripts, titles, and page context. WatchBuddy turns that context into a conversation.

Use it for:

- YouTube explainers and conference talks
- Online courses on Udemy and Coursera
- Long product keynotes
- Netflix-style co-watching experiments
- "Wait, what did they mean by that?" moments

## MVP features

- Chrome Manifest V3 extension
- Side panel chat UI
- `Alt+W` shortcut to open WatchBuddy
- Voice question input with the browser Speech Recognition API
- Current video timestamp and page context capture
- YouTube transcript/caption extraction, best effort
- Netflix, Udemy, and Coursera page/video context extraction, best effort
- BYOK OpenAI API key storage in `chrome.storage.sync`
- No build step

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `watchbuddy` folder.
6. Open a supported video page.
7. Click the WatchBuddy extension icon or press `Alt+W`.
8. Add your OpenAI API key in settings.

## Tips

For best results on YouTube, open the transcript panel or enable captions before asking. Some platforms restrict subtitle access, so WatchBuddy falls back to visible captions and page text.

## Roadmap

- Robust YouTube timed transcript parser
- Local per-video memory
- Streaming answers
- Whisper or Realtime API voice mode
- Bring-your-own-model provider support
- Conversation styles: study tutor, hype friend, skeptic, curator
- Shareable clips with AI explanations
- Better Netflix/Udemy/Coursera adapters

## Privacy

WatchBuddy runs locally in your browser. It sends the captured page/video context and your question to the OpenAI API only when you ask a question. Your API key is stored in Chrome sync storage.

## License

MIT
