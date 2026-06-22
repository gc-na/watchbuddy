const PROVIDERS = {
  "chrome-ai": {
    label: "Chrome built-in AI",
    defaultModel: "Gemini Nano",
    needsKey: false,
    budget: {
      transcriptChars: 2600,
      pageChars: 400,
      preferPreview: true
    }
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "openrouter/free",
    needsKey: true,
    budget: {
      transcriptChars: 7000,
      pageChars: 1200
    }
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    budget: {
      transcriptChars: 9000,
      pageChars: 1500
    }
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    needsKey: true,
    budget: {
      transcriptChars: 7000,
      pageChars: 1200
    }
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4-mini",
    needsKey: true,
    budget: {
      transcriptChars: 10000,
      pageChars: 1800
    }
  },
  ollama: {
    label: "Ollama local",
    defaultModel: "llama3.2",
    needsKey: false,
    budget: {
      transcriptChars: 4500,
      pageChars: 800
    }
  }
};

const DEFAULT_PROVIDER = "chrome-ai";

const els = {
  apiKey: document.querySelector("#apiKey"),
  composer: document.querySelector("#composer"),
  contextCard: document.querySelector("#contextCard"),
  contextPreview: document.querySelector("#contextPreview"),
  contextPreviewWrap: document.querySelector("#contextPreviewWrap"),
  messages: document.querySelector("#messages"),
  model: document.querySelector("#model"),
  platform: document.querySelector("#platform"),
  provider: document.querySelector("#provider"),
  question: document.querySelector("#question"),
  saveSettings: document.querySelector("#saveSettings"),
  sendButton: document.querySelector("#sendButton"),
  settings: document.querySelector("#settings"),
  settingsButton: document.querySelector("#settingsButton"),
  status: document.querySelector("#status"),
  timestamp: document.querySelector("#timestamp"),
  videoTitle: document.querySelector("#videoTitle"),
  voiceButton: document.querySelector("#voiceButton")
};

let latestContext = null;
let recognition = null;

init();

async function init() {
  const saved = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "model", "provider"]);
  const provider = saved.provider || DEFAULT_PROVIDER;
  els.provider.value = provider;
  els.apiKey.value = saved.apiKey || saved.openaiApiKey || "";
  els.model.value = saved.model || PROVIDERS[provider].defaultModel;
  syncProviderFields();

  els.settings.hidden = Boolean(saved.apiKey || saved.openaiApiKey || !PROVIDERS[provider].needsKey);
  wireEvents();
  addMessage("assistant", "Hi, I am ready. Open a video, then ask me anything about the part you are watching.");
  try {
    await refreshContext();
  } catch (error) {
    renderNoContext(error.message);
  }
}

function wireEvents() {
  els.settingsButton.addEventListener("click", () => {
    els.settings.hidden = !els.settings.hidden;
  });

  els.saveSettings.addEventListener("click", async () => {
    await chrome.storage.sync.set({
      provider: els.provider.value,
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || PROVIDERS[els.provider.value].defaultModel
    });
    els.settings.hidden = true;
    setStatus("Settings saved.");
  });

  els.provider.addEventListener("change", () => {
    els.model.value = PROVIDERS[els.provider.value].defaultModel;
    syncProviderFields();
  });

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await askQuestion(els.question.value.trim());
  });

  els.voiceButton.addEventListener("click", toggleSpeechRecognition);
}

async function askQuestion(question) {
  if (!question) return;

  const { apiKey, openaiApiKey, model, provider } = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "model", "provider"]);
  const selectedProvider = provider || DEFAULT_PROVIDER;
  const selectedApiKey = apiKey || openaiApiKey || "";

  if (PROVIDERS[selectedProvider].needsKey && !selectedApiKey) {
    els.settings.hidden = false;
    setStatus(`Add your ${PROVIDERS[selectedProvider].label} API key first.`);
    return;
  }

  els.question.value = "";
  addMessage("user", question);
  setBusy(true, "Reading this moment...");

  try {
    latestContext = await refreshContext();
    const answer = await callAI({
      provider: selectedProvider,
      apiKey: selectedApiKey,
      model: model || PROVIDERS[selectedProvider].defaultModel,
      question,
      context: latestContext
    });
    addMessage("assistant", answer);
    setStatus("Ready.");
  } catch (error) {
    addMessage("assistant", `I hit an error: ${error.message}`);
    setStatus("Something went wrong.");
  } finally {
    setBusy(false);
  }
}

async function refreshContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  const response = await chrome.tabs.sendMessage(tab.id, { type: "WATCHBUDDY_GET_CONTEXT" });
  if (!response?.ok) {
    throw new Error(response?.error || "Open YouTube, Netflix, Udemy, or Coursera and try again.");
  }

  renderContext(response.context);
  return response.context;
}

function renderContext(context) {
  const time = context.currentTime == null ? "" : formatTime(context.currentTime);
  const duration = context.duration == null ? "" : formatTime(context.duration);
  els.platform.textContent = context.platform || "Video page";
  els.videoTitle.textContent = context.title || "Untitled video";
  els.timestamp.textContent = duration ? `${time} / ${duration}` : time;
  els.contextPreview.textContent = context.transcriptPreview || context.transcript?.slice(0, 900) || "";
  els.contextPreviewWrap.hidden = !els.contextPreview.textContent;
  setStatus(context.transcript ? "Context captured." : "Context captured. Transcript may be limited.");
}

function renderNoContext(reason) {
  els.platform.textContent = "No supported video page";
  els.videoTitle.textContent = "Open YouTube, Netflix, Udemy, or Coursera.";
  els.timestamp.textContent = "";
  els.contextPreview.textContent = "";
  els.contextPreviewWrap.hidden = true;
  setStatus(reason || "Open a supported video tab.");
}

async function callAI({ provider, apiKey, model, question, context }) {
  if (provider === "gemini") return callGemini({ apiKey, model, question, context });
  if (provider === "openai") return callOpenAIResponses({ apiKey, model, question, context });
  if (provider === "chrome-ai") return callChromeBuiltInAI({ question, context });

  const endpoints = {
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
    ollama: "http://localhost:11434/v1/chat/completions"
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/watchbuddy/watchbuddy";
    headers["X-Title"] = "WatchBuddy";
  }

  const response = await fetch(endpoints[provider], {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: buildMessages(question, context, provider),
      temperature: 0.4
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `${PROVIDERS[provider].label} request failed (${response.status})`);
  }

  return data?.choices?.[0]?.message?.content?.trim() || "I did not receive a text answer.";
}

async function callChromeBuiltInAI({ question, context }) {
  if (!("LanguageModel" in globalThis)) {
    throw new Error("Chrome built-in AI is not available in this browser yet. Try Chrome desktop, enable built-in AI, or use another provider.");
  }

  const availability = await LanguageModel.availability();
  if (availability === "unavailable") {
    throw new Error("Chrome built-in AI is unavailable on this device or Chrome profile.");
  }

  setStatus(availability === "downloadable" || availability === "downloading"
    ? "Downloading Chrome's local AI model..."
    : "Using Chrome's local AI model...");

  const session = await LanguageModel.create({
    initialPrompts: [
      {
        role: "system",
        content: systemPrompt()
      }
    ],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const percent = Math.round((event.loaded || 0) * 100);
        setStatus(`Downloading Chrome's local AI model... ${percent}%`);
      });
    }
  });

  try {
    let answer;
    try {
      answer = await session.prompt(buildPrompt(question, context, "chrome-ai"));
    } catch (error) {
      if (!/too large|input.*large|token|context/i.test(error.message || "")) throw error;
      setStatus("Context was large. Retrying with a smaller moment...");
      answer = await session.prompt(buildMinimalPrompt(question, context));
    }
    return answer.trim() || "I did not receive a text answer.";
  } finally {
    session.destroy?.();
  }
}

async function callOpenAIResponses({ apiKey, model, question, context }) {
  const input = buildMessages(question, context, "openai").map((message) => ({
    role: message.role === "system" ? "developer" : message.role,
    content: [{ type: "input_text", text: message.content }]
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }

  return extractResponseText(data) || "I did not receive a text answer.";
}

async function callGemini({ apiKey, model, question, context }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt() }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(question, context, "gemini") }]
        }
      ],
      generationConfig: {
        temperature: 0.4
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
  }

  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim() || "I did not receive a text answer.";
}

function buildMessages(question, context, provider) {
  return [
    {
      role: "system",
      content: systemPrompt()
    },
    {
      role: "user",
      content: buildPrompt(question, context, provider)
    }
  ];
}

function systemPrompt() {
  return [
    "You are WatchBuddy, a friendly AI companion for people watching videos.",
    "Use the supplied video context, transcript, current timestamp, and user question.",
    "If the transcript is incomplete, say what you can infer and ask for the transcript panel or captions if needed.",
    "Be concise, specific, and helpful. Match the user's language."
  ].join(" ");
}

function syncProviderFields() {
  const provider = PROVIDERS[els.provider.value];
  els.apiKey.placeholder = provider.needsKey ? "Paste provider API key" : "Not needed for Ollama";
  els.apiKey.disabled = !provider.needsKey;
  els.model.disabled = els.provider.value === "chrome-ai";
}

function buildPrompt(question, context, provider = DEFAULT_PROVIDER) {
  const budget = PROVIDERS[provider]?.budget || PROVIDERS[DEFAULT_PROVIDER].budget;
  const transcriptContext = buildTranscriptContext(context, budget);
  const pageContext = clipText(context.pageText || "", budget.pageChars);

  return [
    `Question: ${question}`,
    "",
    "Video context:",
    `Platform: ${context.platform}`,
    `Title: ${context.title}`,
    `URL: ${context.url}`,
    `Current time: ${context.currentTime == null ? "unknown" : formatTime(context.currentTime)}`,
    `Duration: ${context.duration == null ? "unknown" : formatTime(context.duration)}`,
    "",
    "Transcript preview around the current time:",
    context.transcriptPreview || "(No nearby transcript preview captured.)",
    "",
    "Relevant transcript/captions:",
    transcriptContext || "(No transcript captured.)",
    "",
    "Small page context:",
    pageContext || "(No page text captured.)"
  ].join("\n");
}

function buildTranscriptContext(context, budget) {
  const preview = context.transcriptPreview || "";
  const transcript = context.transcript || "";

  if (budget.preferPreview && preview) {
    return clipText(preview, budget.transcriptChars);
  }

  const timedWindow = selectTimedTranscriptWindow(transcript, context.currentTime, budget.transcriptChars);
  return timedWindow || clipText(preview || transcript, budget.transcriptChars);
}

function selectTimedTranscriptWindow(transcript, currentTime, maxChars) {
  if (!transcript || currentTime == null) return "";

  const timedLines = transcript
    .split("\n")
    .map((line) => {
      const match = line.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      return match ? { line, seconds: parseTimestamp(match[1]) } : null;
    })
    .filter(Boolean);

  if (!timedLines.length) return "";

  const nearby = timedLines.filter((item) => Math.abs(item.seconds - currentTime) <= 150);
  const candidates = nearby.length ? nearby : timedLines;
  const anchorIndex = candidates.findIndex((item) => item.seconds >= currentTime);
  const startIndex = Math.max(0, (anchorIndex === -1 ? 0 : anchorIndex) - 8);
  const selected = candidates.slice(startIndex, startIndex + 28).map((item) => item.line).join("\n");
  return clipText(selected, maxChars);
}

function clipText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 40;
  return `${text.slice(0, head).trim()}\n...\n${text.slice(Math.max(0, text.length - tail)).trim()}`;
}

function buildMinimalPrompt(question, context) {
  return [
    `Question: ${question}`,
    `Title: ${context.title || "Untitled video"}`,
    `Current time: ${context.currentTime == null ? "unknown" : formatTime(context.currentTime)}`,
    "",
    "Only use this nearby transcript:",
    clipText(context.transcriptPreview || context.transcript || "", 1200)
  ].join("\n");
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text.trim();

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function toggleSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not available in this browser.");
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    els.voiceButton.classList.remove("listening");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    els.voiceButton.classList.add("listening");
    setStatus("Listening...");
  };

  recognition.onresult = (event) => {
    const transcript = [...event.results]
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    els.question.value = transcript;
    if (transcript) askQuestion(transcript);
  };

  recognition.onerror = (event) => {
    setStatus(`Voice input failed: ${event.error}`);
  };

  recognition.onend = () => {
    recognition = null;
    els.voiceButton.classList.remove("listening");
  };

  recognition.start();
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = text;
  els.messages.append(message);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setBusy(isBusy, status = "Working...") {
  els.sendButton.disabled = isBusy;
  els.voiceButton.disabled = isBusy;
  if (isBusy) setStatus(status);
}

function setStatus(text) {
  els.status.textContent = text;
}

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function parseTimestamp(timestamp) {
  const parts = timestamp.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}
