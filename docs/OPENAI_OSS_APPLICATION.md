# OpenAI Codex for Open Source Application Notes

OpenAI has a Codex for Open Source program for maintainers of active public open-source projects. The official page says selected maintainers may receive six months of ChatGPT Pro with Codex, API credits, and conditional Codex Security access.

Official links:

- https://developers.openai.com/community/codex-for-oss
- https://openai.com/form/codex-for-oss/

## Repository pitch

WatchBuddy is an open-source browser extension that turns video transcripts, timestamps, captions, and page metadata into a local-first AI co-watching companion.

It helps people understand long videos, online courses, conference talks, travel vlogs, product keynotes, and other media without leaving the page.

## Maintainer role

Primary maintainer.

## Why this repository matters

Video knowledge is increasingly locked inside long-form media. WatchBuddy makes that knowledge conversational while respecting user choice: Chrome built-in AI, local Ollama, and bring-your-own-key cloud providers are all supported. The project is useful for learners, accessibility workflows, online courses, and people who want AI help while staying in control of their video context.

## How API credits would be used

API credits would support provider testing, transcript accuracy evaluation, PR review automation, regression testing across video platforms, and optional hosted fallback experiments for users who cannot access Chrome built-in AI or local models.

## Anything else

The project is MIT licensed, browser-first, and designed to avoid shipping shared API keys. It includes validation for transcript grounding and direct-answer quality.
