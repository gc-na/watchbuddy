const DEFAULT_MODEL = "gpt-5.5";

const els = {
  apiKey: document.querySelector("#apiKey"),
  composer: document.querySelector("#composer"),
  contextCard: document.querySelector("#contextCard"),
  messages: document.querySelector("#messages"),
  model: document.querySelector("#model"),
  platform: document.querySelector("#platform"),
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
  const saved = await chrome.storage.sync.get(["openaiApiKey", "model"]);
  els.apiKey.value = saved.openaiApiKey || "";
  els.model.value = saved.model || DEFAULT_MODEL;

  els.settings.hidden = Boolean(saved.openaiApiKey);
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
      openaiApiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || DEFAULT_MODEL
    });
    els.settings.hidden = true;
    setStatus("Settings saved.");
  });

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await askQuestion(els.question.value.trim());
  });

  els.voiceButton.addEventListener("click", toggleSpeechRecognition);
}

async function askQuestion(question) {
  if (!question) return;

  const { openaiApiKey, model } = await chrome.storage.sync.get(["openaiApiKey", "model"]);
  if (!openaiApiKey) {
    els.settings.hidden = false;
    setStatus("Add your OpenAI API key first.");
    return;
  }

  els.question.value = "";
  addMessage("user", question);
  setBusy(true, "Reading this moment...");

  try {
    latestContext = await refreshContext();
    const answer = await callOpenAI({
      apiKey: openaiApiKey,
      model: model || DEFAULT_MODEL,
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

async function callOpenAI({ apiKey, model, question, context }) {
  const input = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: [
            "You are WatchBuddy, a friendly AI companion for people watching videos.",
            "Use the supplied video context, transcript, current timestamp, and user question.",
            "If the transcript is incomplete, say what you can infer and ask for the transcript panel or captions if needed.",
            "Be concise, specific, and helpful. Match the user's language."
          ].join(" ")
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: buildPrompt(question, context)
        }
      ]
    }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }

  return extractOutputText(data) || "I did not receive a text answer.";
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

function extractOutputText(data) {
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
