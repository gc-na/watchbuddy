const PROVIDERS = {
  "chrome-ai": {
    label: "Chrome built-in AI",
    defaultModel: "Gemini Nano",
    needsKey: false
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "openrouter/free",
    needsKey: true
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    needsKey: true
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    needsKey: true
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4-mini",
    needsKey: true
  },
  ollama: {
    label: "Ollama local",
    defaultModel: "llama3.2",
    needsKey: false
  }
};

const DEFAULT_PROVIDER = "chrome-ai";

const els = {
  apiKey: document.querySelector("#apiKey"),
  composer: document.querySelector("#composer"),
  contextCard: document.querySelector("#contextCard"),
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
  setStatus(context.transcript ? "Context captured." : "Context captured. Transcript may be limited.");
}

function renderNoContext(reason) {
  els.platform.textContent = "No supported video page";
  els.videoTitle.textContent = "Open YouTube, Netflix, Udemy, or Coursera.";
  els.timestamp.textContent = "";
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
      messages: buildMessages(question, context),
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
    const answer = await session.prompt(buildPrompt(question, context));
    return answer.trim() || "I did not receive a text answer.";
  } finally {
    session.destroy?.();
  }
}

async function callOpenAIResponses({ apiKey, model, question, context }) {
  const input = buildMessages(question, context).map((message) => ({
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
          parts: [{ text: buildPrompt(question, context) }]
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

function buildMessages(question, context) {
  return [
    {
      role: "system",
      content: systemPrompt()
    },
    {
      role: "user",
      content: buildPrompt(question, context)
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

function buildPrompt(question, context) {
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
    "Transcript/captions near or from the video:",
    context.transcript || "(No transcript captured.)",
    "",
    "Visible page text:",
    context.pageText || "(No page text captured.)"
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
