# Security

## Reporting

Please do not open public issues for vulnerabilities involving API keys, extension permissions, prompt injection, transcript exfiltration, or provider abuse.

Report security concerns privately to the maintainer using the contact information listed on the GitHub profile or repository.

## Scope

WatchBuddy currently stores provider API keys in `chrome.storage.sync` and sends video context to the selected provider only when the user asks a question.

Security-sensitive areas:

- Provider API key handling
- Prompt injection from page/transcript content
- Extension host permissions
- Local Ollama requests
- Chrome built-in AI availability and fallback behavior

## Maintainer checklist

- Keep host permissions narrow.
- Never ship a shared provider API key in the extension.
- Treat page text, transcript text, email, and provider output as untrusted.
- Prefer local or bring-your-own-key provider modes.
