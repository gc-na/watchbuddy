# Launch Notes

## One-line pitch

WatchBuddy is an open-source AI co-watching sidekick for YouTube, courses, keynotes, streaming videos, and long rabbit-hole sessions.

## Short post

I built WatchBuddy, a tiny Chrome extension that lets you ask an AI about the video you are watching.

It reads the current timestamp, visible captions/transcripts, and page context, then answers like a study buddy, event curator, or friend watching with you.

The first MVP supports YouTube best, with best-effort context capture for Netflix, Udemy, Coursera, Bilibili, and other active video tabs. It supports Chrome built-in AI, OpenRouter, Gemini, Groq, OpenAI, and local Ollama from one settings panel.

It has voice questions, optional spoken answers, dark mode, prompt budgeting for long videos, and a local validation suite for transcript grounding regressions.

MIT licensed. Use Chrome built-in AI when available, bring your own API key, or use local Ollama. No build step.

## Social launch copy

I built WatchBuddy: an MIT Chrome extension that lets you talk to the video you are watching.

It reads the current timestamp, captions/transcripts, page metadata, and recent chat, then answers like a study buddy or co-watching friend. Works best on YouTube today, with adapters/fallbacks for courses and streaming sites.

I want this to become the open-source layer for "AI that watches with you." Fork it, add platform adapters, improve grounding, wire in local models, or make it weird and useful.

## Demo ideas

- Ask "explain this part like I am new to the topic" during a Google I/O talk.
- Ask "quiz me on the last 3 minutes" during a course.
- Ask "what should I pay attention to next?" during a long keynote.
- Ask by microphone and let WatchBuddy answer out loud while you keep watching.
