const PROVIDERS = {
  "chrome-ai": {
    label: "Chrome built-in AI",
    defaultModel: "Gemini Nano",
    needsKey: false,
    budget: {
      transcriptChars: 2600,
      metadataChars: 1000,
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
      metadataChars: 1800,
      pageChars: 1200
    }
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    budget: {
      transcriptChars: 9000,
      metadataChars: 2200,
      pageChars: 1500
    }
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    needsKey: true,
    budget: {
      transcriptChars: 7000,
      metadataChars: 1800,
      pageChars: 1200
    }
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.4-mini",
    needsKey: true,
    budget: {
      transcriptChars: 10000,
      metadataChars: 2400,
      pageChars: 1800
    }
  },
  ollama: {
    label: "Ollama local",
    defaultModel: "llama3.2",
    needsKey: false,
    budget: {
      transcriptChars: 4500,
      metadataChars: 1200,
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
  theme: document.querySelector("#theme"),
  timestamp: document.querySelector("#timestamp"),
  videoTitle: document.querySelector("#videoTitle"),
  voiceButton: document.querySelector("#voiceButton"),
  voiceReplies: document.querySelector("#voiceReplies")
};

let latestContext = null;
let recognition = null;
let chatHistory = [];
let speakNextAnswer = false;

init();

async function init() {
  const saved = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "model", "provider", "theme", "voiceReplies"]);
  const provider = saved.provider || DEFAULT_PROVIDER;
  els.provider.value = provider;
  els.apiKey.value = saved.apiKey || saved.openaiApiKey || "";
  els.model.value = saved.model || PROVIDERS[provider].defaultModel;
  els.theme.value = saved.theme || globalThis.WatchBuddyTheme?.defaultTheme || "system";
  els.voiceReplies.checked = Boolean(saved.voiceReplies);
  globalThis.WatchBuddyTheme?.apply(els.theme.value);
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
      model: els.model.value.trim() || PROVIDERS[els.provider.value].defaultModel,
      theme: els.theme.value,
      voiceReplies: els.voiceReplies.checked
    });
    els.settings.hidden = true;
    setStatus("Settings saved.");
  });

  els.theme.addEventListener("change", () => {
    globalThis.WatchBuddyTheme?.apply(els.theme.value);
  });

  els.provider.addEventListener("change", () => {
    els.model.value = PROVIDERS[els.provider.value].defaultModel;
    syncProviderFields();
  });

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await askQuestion(els.question.value.trim());
  });

  els.question.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (typeof els.composer.requestSubmit === "function") {
      els.composer.requestSubmit();
    } else {
      els.sendButton.click();
    }
  });

  els.voiceButton.addEventListener("click", toggleSpeechRecognition);
}

async function askQuestion(question) {
  if (!question) return;

  const { apiKey, openaiApiKey, model, provider, voiceReplies } = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "model", "provider", "voiceReplies"]);
  const selectedProvider = provider || DEFAULT_PROVIDER;
  const selectedApiKey = apiKey || openaiApiKey || "";
  const shouldSpeakAnswer = Boolean(voiceReplies) || speakNextAnswer;
  speakNextAnswer = false;

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
    const directAnswer = answerDirectlyFromContext(question, latestContext);
    if (directAnswer) {
      rememberMessage("user", question);
      addMessage("assistant", directAnswer);
      rememberMessage("assistant", directAnswer);
      speakAnswer(directAnswer, question, shouldSpeakAnswer);
      setStatus("Answered from transcript.");
      return;
    }

    const answer = await callAI({
      provider: selectedProvider,
      apiKey: selectedApiKey,
      model: model || PROVIDERS[selectedProvider].defaultModel,
      question,
      context: latestContext
    });
    rememberMessage("user", question);
    addMessage("assistant", answer);
    rememberMessage("assistant", answer);
    speakAnswer(answer, question, shouldSpeakAnswer);
    setStatus("Ready.");
  } catch (error) {
    const errorText = `I hit an error: ${error.message}`;
    rememberMessage("user", question);
    addMessage("assistant", errorText);
    rememberMessage("assistant", errorText);
    setStatus("Something went wrong.");
  } finally {
    setBusy(false);
  }
}

async function refreshContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  let response = await requestContextFromTab(tab.id);
  if (!response?.ok) {
    await injectContentScript(tab.id);
    response = await requestContextFromTab(tab.id);
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Open a video page and try again.");
  }

  renderContext(response.context);
  return response.context;
}

async function requestContextFromTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "WATCHBUDDY_GET_CONTEXT" });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function injectContentScript(tabId) {
  if (!chrome.scripting?.executeScript) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    await delay(120);
  } catch (_error) {
    // Restricted browser pages and some web stores cannot receive extension scripts.
  }
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
  els.videoTitle.textContent = "Open YouTube, Netflix, Udemy, Coursera, Bilibili, or another video page.";
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

  const messages = buildMessages(question, context, provider);
  const response = await fetch(endpoints[provider], {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `${PROVIDERS[provider].label} request failed (${response.status})`);
  }

  const answer = data?.choices?.[0]?.message?.content?.trim() || "";
  if (needsQualityRetry(answer, question)) {
    return retryChatCompletion({ endpoint: endpoints[provider], headers, model, provider, question, context, badAnswer: answer });
  }

  return answer || "I did not receive a text answer.";
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
    if (needsQualityRetry(answer, question)) {
      setStatus("Answer looked weak. Retrying with stricter grounding...");
      answer = await session.prompt(buildRepairPrompt(question, context, answer, "chrome-ai"));
    }
    if (needsQualityRetry(answer, question)) {
      answer = buildFallbackAnswer(question, context);
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

  const answer = extractResponseText(data) || "";
  if (needsQualityRetry(answer, question)) {
    return retryOpenAIResponses({ apiKey, model, question, context, badAnswer: answer });
  }

  return answer || "I did not receive a text answer.";
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

  const answer = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (needsQualityRetry(answer, question)) {
    return retryGemini({ apiKey, model, question, context, badAnswer: answer });
  }

  return answer || "I did not receive a text answer.";
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
    "You are WatchBuddy, an AI companion watching the same video as the user.",
    "Answer from the current timestamp, transcript, title, and recent chat.",
    "Resolve casual references like '얘', '이 사람', '이거', '그거', '그래서' to the main speaker, subject, or moment in the current video unless the chat clearly says otherwise.",
    "Trust the transcript over generic page text. If the transcript contains the answer, do not say the information is limited.",
    "You cannot hear raw audio or inspect video pixels unless those details appear in provided text context. For music or exact visual-place questions, state that limitation briefly when needed.",
    "Do not repeat or rephrase the user's question as the answer.",
    "Answer in the user's language. If the user writes Korean, answer naturally in Korean.",
    "Be short, direct, and conversational."
  ].join(" ");
}

function syncProviderFields() {
  const provider = PROVIDERS[els.provider.value];
  els.apiKey.placeholder = provider.needsKey ? "Paste provider API key" : "No API key needed";
  els.apiKey.disabled = !provider.needsKey;
  els.model.disabled = els.provider.value === "chrome-ai";
}

function buildPrompt(question, context, provider = DEFAULT_PROVIDER) {
  const budget = PROVIDERS[provider]?.budget || PROVIDERS[DEFAULT_PROVIDER].budget;
  const transcriptContext = buildTranscriptContext(context, budget);
  const metadataContext = formatMetadata(context.metadata, budget.metadataChars || 1000);
  const pageContext = clipText(context.pageText || "", budget.pageChars);
  const focusedTranscript = buildFocusedTranscript(context, budget);
  const languageHint = detectLanguage(question);
  const recentChat = formatRecentChat(provider);
  const intent = detectQuestionIntent(question);

  return [
    languageHint === "Korean" ? "답변 규칙:" : "Answer rules:",
    languageHint === "Korean"
      ? "- 질문을 반복하지 말고, 첫 문장부터 답을 말해."
      : "- Do not repeat the question. Answer directly in the first sentence.",
    languageHint === "Korean"
      ? "- 근거가 부족하면 '정확히는 컨텍스트에 없다'고 말하고, 지금 알 수 있는 범위를 말해."
      : "- If evidence is missing, say what is missing and what can still be inferred.",
    languageHint === "Korean"
      ? "- '얘/이 사람/여기/이거/그거'는 현재 영상 장면의 주인공, 장소, 대상이라고 보고 해석해."
      : "- Resolve pronouns to the speaker, place, or object in the current video moment.",
    languageHint === "Korean"
      ? "- 노래/정확한 장소처럼 화면 글자나 실제 오디오가 필요한 질문은, 제공된 텍스트에 없으면 그 한계를 짧게 밝혀."
      : "- For music or exact visual place questions, mention limitations if the provided text does not contain the answer.",
    "",
    `User language: ${languageHint}`,
    `Answer language: ${languageHint}`,
    `Question intent: ${intent}`,
    `User question: ${question}`,
    "",
    "Conversation so far:",
    recentChat || "(No previous chat.)",
    "",
    "Video context:",
    `Platform: ${context.platform}`,
    `Title: ${context.title}`,
    `URL: ${context.url}`,
    `Current time: ${context.currentTime == null ? "unknown" : formatTime(context.currentTime)}`,
    `Duration: ${context.duration == null ? "unknown" : formatTime(context.duration)}`,
    "",
    "Video metadata:",
    metadataContext || "(No metadata captured.)",
    "",
    "Current caption line:",
    context.currentTranscript || "(No current caption captured.)",
    "",
    "Nearby caption lines:",
    focusedTranscript || "(No nearby caption lines captured.)",
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

function buildFocusedTranscript(context, budget) {
  const nearby = context.nearbyTranscript || "";
  if (nearby) return clipText(nearby, Math.min(budget.transcriptChars, 2200));
  return "";
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
    `Answer in: ${detectLanguage(question)}`,
    `User question: ${question}`,
    `Title: ${context.title || "Untitled video"}`,
    `Current time: ${context.currentTime == null ? "unknown" : formatTime(context.currentTime)}`,
    "Resolve '얘/이 사람/이거/그거' as the main speaker or subject in this video moment.",
    "Do not repeat the question. If the exact answer is not in the text, say what is missing and what can be inferred.",
    "",
    "Only use this nearby transcript:",
    clipText(context.nearbyTranscript || context.transcriptPreview || context.transcript || "", 1200)
  ].join("\n");
}

function answerDirectlyFromContext(question, context) {
  const intent = detectQuestionIntent(question);
  const nearbyText = [
    context.currentTranscript,
    context.nearbyTranscript,
    context.transcriptPreview
  ].filter(Boolean).join("\n");

  if (intent === "music") {
    return answerMusicQuestion(question, context, nearbyText);
  }

  if (intent === "place") {
    return answerPlaceQuestion(question, context, nearbyText);
  }

  const situationAnswer = answerSituationQuestion(question, context, nearbyText);
  if (situationAnswer) return situationAnswer;

  const meetingAnswer = answerMeetingQuestion(question, nearbyText);
  if (meetingAnswer) return meetingAnswer;

  const priceAnswer = answerPriceQuestion(question, nearbyText);
  if (priceAnswer) return priceAnswer;

  return "";
}

function answerMeetingQuestion(question, text) {
  if (!/(뭐|무엇|누구|누굴|뭘).{0,8}(만나|만날|마주|나와|나올|있을|생길)|만날.{0,8}(뭐|누구|무엇)/.test(question)) {
    return "";
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/([가-힣A-Za-z0-9]{1,12})(?:하고|이랑|랑|와|과)\s*만날\s*것\s*같/);
    if (match) return `${match[1]}랑 만날 것 같다고 했어요.`;
  }

  for (const line of lines) {
    const match = line.match(/([가-힣A-Za-z0-9]{1,12})(?:하고|이랑|랑|와|과)\s*만나면/);
    if (match) return `${match[1]}랑 만난다는 얘기였어요.`;
  }

  return "";
}

function answerPriceQuestion(question, text) {
  if (!/(얼마|가격|몇\s*원|비싸|price|cost)/i.test(question)) return "";

  const match = text.match(/(\d+(?:만|천)?(?:\d{1,3})?(?:,\d{3})?\s*원|\d+(?:\.\d+)?\s*만원|\d+(?:\.\d+)?\s*천원)/);
  if (!match) return "";

  return `자막 기준으로는 ${match[1].replace(/\s+/g, "")}이라고 했어요.`;
}

function answerMusicQuestion(_question, context, text) {
  const evidence = [context.title, formatMetadata(context.metadata, 800), text].filter(Boolean).join("\n");
  const quoted = evidence.match(/[\"'“”‘’]([^\"'“”‘’]{2,80})[\"'“”‘’]/);
  if (quoted && /song|music|노래|곡|ost|bgm|album|track/i.test(evidence)) {
    return `텍스트 컨텍스트 기준으로는 “${quoted[1]}”가 곡명 후보예요.`;
  }

  const englishTitle = evidence.match(/\b([A-Z][A-Za-z0-9'’.-]{2,}(?:\s+[A-Z][A-Za-z0-9'’.-]{1,}){0,5})\b/);
  if (englishTitle && /song|music|노래|곡|ost|bgm|album|track/i.test(evidence)) {
    return `텍스트 컨텍스트 기준으로는 “${englishTitle[1]}”가 곡명 후보예요.`;
  }

  return "정확한 곡명은 지금 캡처된 자막/제목/설명에는 안 나와요. WatchBuddy는 현재 배경음 자체를 듣거나 영상 속 글자를 OCR로 읽지는 못해서, 텍스트에 곡명이 없으면 확인할 수 없습니다.";
}

function answerPlaceQuestion(_question, context, text) {
  const evidence = [context.title, formatMetadata(context.metadata, 1200), text].filter(Boolean).join("\n");
  const place = inferPlace(evidence);
  if (!place) return "";

  const focusedText = [
    context.currentTranscript || "",
    ...getFocusedPlainLines(context, text)
  ].join("\n");

  if (/해변|바닷가|항구|동굴|사막|마을|역|공항|시장|사원|절|산|섬|언덕|비석|표지판|증권\s*거래소/.test(focusedText)) {
    return `정확한 지점명까지는 자막에 없지만, 큰 위치는 ${place} 쪽이고 지금 장면은 ${extractSceneHint(focusedText)}인 것으로 보여요.`;
  }

  return `제목/설명/자막 기준으로는 ${place} 쪽이에요.`;
}

function answerSituationQuestion(question, context, text) {
  if (!/(지금|여기|이거|이 장면|현재).{0,10}(무슨|뭔|뭐).{0,8}(얘기|상황|하는|중|말)|무슨\s*얘기|뭔\s*얘기/.test(question)) {
    return "";
  }

  const current = (context.currentTranscript || "")
    .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "")
    .trim();
  const lines = getFocusedPlainLines(context, text);
  const useful = [current, ...lines]
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index)
    .slice(0, 3)
    .join(" / ");

  if (!useful) return "";
  return `지금은 이 대목 얘기예요: ${clipInline(useful, 220)}`;
}

function clipInline(text, maxChars) {
  const inline = String(text || "").replace(/\s+/g, " ").trim();
  return inline.length <= maxChars ? inline : `${inline.slice(0, maxChars - 1).trim()}…`;
}

function getFocusedPlainLines(context, text) {
  if (Array.isArray(context.transcriptRows) && context.transcriptRows.length) {
    const rows = context.transcriptRows;
    const foundIndex = rows.findIndex((row) => row.seconds >= (context.currentTime || 0));
    const index = foundIndex === -1 ? rows.length - 1 : Math.max(0, foundIndex);
    return rows
      .slice(Math.max(0, index - 1), index + 3)
      .map((row) => row.text)
      .filter(Boolean);
  }

  const parsed = (context.nearbyTranscript || text)
    .split("\n")
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
      return match ? { seconds: parseTimestamp(match[1]), text: match[2].trim() } : null;
    })
    .filter(Boolean);

  if (!parsed.length) {
    return (context.nearbyTranscript || text)
      .split("\n")
      .map((line) => line.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const currentTime = context.currentTime || parsed[0].seconds;
  const foundIndex = parsed.findIndex((row) => row.seconds >= currentTime);
  const index = foundIndex === -1 ? parsed.length - 1 : Math.max(0, foundIndex);
  return parsed.slice(Math.max(0, index - 1), index + 3).map((row) => row.text);
}

function extractSceneHint(text) {
  if (/동굴/.test(text)) return "동굴 안";
  if (/비석|표지판|언덕/.test(text)) return "역사 표지판/언덕 근처";
  if (/증권\s*거래소/.test(text)) return "증권거래소";
  if (/해변|바닷가/.test(text)) return "바닷가";
  if (/항구|배/.test(text)) return "항구 근처";
  if (/사막/.test(text)) return "사막";
  if (/역/.test(text)) return "역 근처";
  if (/마을|소도시/.test(text)) return "마을/소도시";
  return "현재 보이는 장소";
}

function buildRepairPrompt(question, context, badAnswer, provider = DEFAULT_PROVIDER) {
  const languageHint = detectLanguage(question);
  const budget = PROVIDERS[provider]?.budget || PROVIDERS[DEFAULT_PROVIDER].budget;
  return [
    languageHint === "Korean" ? "방금 답변은 품질 기준을 통과하지 못했어." : "The previous answer failed the quality bar.",
    `Bad answer: ${badAnswer || "(empty)"}`,
    "",
    languageHint === "Korean"
      ? "다시 답해. 질문을 따라 하지 말고, 자막/제목/설명에서 확인되는 사실만 근거로 짧게 답해."
      : "Answer again. Do not echo the question. Use only facts from the title, metadata, transcript, and recent chat.",
    languageHint === "Korean"
      ? "정확히 모르면 '정확한 곡명/장소는 제공된 텍스트에 없다'고 말하고, 대신 지금 알 수 있는 내용을 말해."
      : "If the exact music/place is absent, say that plainly, then give the best supported context.",
    "",
    buildPrompt(question, context, provider === "chrome-ai" ? "chrome-ai" : provider).slice(0, budget.transcriptChars + (budget.metadataChars || 1000) + 1800)
  ].join("\n");
}

async function retryChatCompletion({ endpoint, headers, model, provider, question, context, badAnswer }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: buildRepairPrompt(question, context, badAnswer, provider) }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `${PROVIDERS[provider].label} retry failed (${response.status})`);
  }

  const answer = data?.choices?.[0]?.message?.content?.trim() || badAnswer || "";
  return needsQualityRetry(answer, question) ? buildFallbackAnswer(question, context) : answer;
}

async function retryOpenAIResponses({ apiKey, model, question, context, badAnswer }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "developer", content: [{ type: "input_text", text: systemPrompt() }] },
        { role: "user", content: [{ type: "input_text", text: buildRepairPrompt(question, context, badAnswer, "openai") }] }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI retry failed (${response.status})`);
  }

  const answer = extractResponseText(data) || badAnswer || "";
  return needsQualityRetry(answer, question) ? buildFallbackAnswer(question, context) : answer;
}

async function retryGemini({ apiKey, model, question, context, badAnswer }) {
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
          parts: [{ text: buildRepairPrompt(question, context, badAnswer, "gemini") }]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini retry failed (${response.status})`);
  }

  const answer = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim() || badAnswer || "";

  return needsQualityRetry(answer, question) ? buildFallbackAnswer(question, context) : answer;
}

function needsQualityRetry(answer, question) {
  const text = (answer || "").trim();
  if (!text) return true;
  if (text.length < 12) return true;

  const questionLanguage = detectLanguage(question);
  if (questionLanguage === "Korean" && !/[가-힣]/.test(text.slice(0, 300))) return true;

  const normalizedAnswer = normalizeForCompare(text);
  const normalizedQuestion = normalizeForCompare(question);
  if (normalizedAnswer === normalizedQuestion) return true;
  if (normalizedQuestion && normalizedAnswer.includes(normalizedQuestion) && text.length < question.length * 4) return true;
  if (/^(음악이\s*뭐지|여기\s*여기가\s*어디예요|여기가\s*어디(야|예요)?)[?.!…\s]*$/i.test(text)) return true;
  if (/^(what music|where is this|where are we)[?.!…\s]*$/i.test(text)) return true;

  return false;
}

function buildFallbackAnswer(question, context) {
  const language = detectLanguage(question);
  const intent = detectQuestionIntent(question);
  const metadata = formatMetadata(context.metadata, 1000);
  const transcript = context.transcriptPreview || selectTimedTranscriptWindow(context.transcript || "", context.currentTime, 1200) || "";
  const evidence = [context.title, metadata, transcript].filter(Boolean).join("\n");

  if (language !== "Korean") {
    if (intent === "music") {
      return "I cannot identify the exact song from the captured text. WatchBuddy currently sees transcript, title, and page text, but not raw audio or video pixels.";
    }
    if (intent === "place") {
      return `The exact place is not explicit in the captured text. From the title/metadata, this appears to be ${inferPlace(evidence) || "the location shown in the current travel video"}.`;
    }
    return `From the nearby transcript, the relevant context is: ${clipText(transcript || evidence, 300)}`;
  }

  if (intent === "music") {
    return "정확한 곡명은 지금 캡처된 자막/제목/설명에는 안 나와요. WatchBuddy는 현재 배경음 자체를 듣거나 영상 속 글자를 OCR로 읽지는 못해서, 텍스트에 곡명이 없으면 확인할 수 없습니다.";
  }

  if (intent === "place") {
    const place = inferPlace(evidence);
    if (place) {
      return `정확한 해변/장소명까지는 자막에 안 나오지만, 제목/설명 기준으로는 ${place} 쪽 장면으로 보여요.`;
    }
    return "정확한 장소명은 지금 캡처된 자막/설명에는 안 나와요. 다만 현재 장면은 바닷가/항구 근처에서 이동 중인 장면으로 보입니다.";
  }

  return `자막 기준으로 보면 이 대목의 핵심은 이거예요: ${clipText(transcript || evidence, 260)}`;
}

function inferPlace(text) {
  if (/파리|Paris/i.test(text)) return "프랑스 파리";
  if (/우유니|Uyuni/i.test(text)) return "볼리비아 우유니 사막";
  if (/볼리비아|Bolivia/i.test(text)) return "볼리비아";
  if (/마쓰야마|마쯔야마|Matsuyama/i.test(text)) return "일본 시코쿠 마쓰야마";
  if (/시코쿠|Shikoku/i.test(text)) return "일본 시코쿠";
  if (/부산/i.test(text)) return "부산";
  if (/일본/i.test(text)) return "일본";
  return "";
}

function normalizeForCompare(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}가-힣]/gu, "")
    .trim();
}

function formatMetadata(metadata, maxChars) {
  if (!metadata) return "";

  const lines = [
    metadata.ogTitle ? `ogTitle: ${metadata.ogTitle}` : "",
    metadata.description ? `description: ${metadata.description}` : "",
    metadata.ogDescription ? `ogDescription: ${metadata.ogDescription}` : "",
    metadata.channel ? `channel: ${metadata.channel}` : "",
    metadata.keywords ? `keywords: ${metadata.keywords}` : "",
    Array.isArray(metadata.hashtags) && metadata.hashtags.length ? `hashtags: ${metadata.hashtags.join(" ")}` : ""
  ].filter(Boolean);

  return clipText(lines.join("\n"), maxChars);
}

function detectQuestionIntent(question) {
  if (/(노래|음악|bgm|ost|song|music)/i.test(question)) return "music";
  if (/(어디|장소|위치|나라|지역|place|where|location)/i.test(question)) return "place";
  if (/(누구|얘|이 사람|who)/i.test(question)) return "person";
  if (/(왜|이유|why)/i.test(question)) return "why";
  return "general";
}

function formatRecentChat(provider) {
  const budget = provider === "chrome-ai" ? 700 : 1600;
  const recent = chatHistory.slice(-6).map((message) => `${message.role}: ${message.text}`).join("\n");
  return clipText(recent, budget);
}

function rememberMessage(role, text) {
  chatHistory.push({ role, text });
  if (chatHistory.length > 12) {
    chatHistory = chatHistory.slice(-12);
  }
}

function detectLanguage(text) {
  return /[가-힣]/.test(text) ? "Korean" : "English";
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text.trim();

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
}

async function toggleSpeechRecognition() {
  const voice = globalThis.WatchBuddyVoice;
  if (!voice?.getRecognitionConstructor?.()) {
    setStatus("Speech recognition is not available in this browser.");
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    els.voiceButton.classList.remove("listening");
    return;
  }

  try {
    await voice.requestMicrophoneAccess();
    voice.stopSpeaking?.();

    recognition = voice.createRecognizer({
      language: navigator.language || "en-US",
      onStart() {
        els.voiceButton.classList.add("listening");
        setStatus("Listening...");
      },
      onText(transcript) {
        els.question.value = transcript;
        if (transcript) {
          speakNextAnswer = true;
          askQuestion(transcript);
        }
      },
      onError(error) {
        setStatus(formatVoiceError(error));
      },
      onEnd() {
        recognition = null;
        els.voiceButton.classList.remove("listening");
      }
    });

    recognition.start();
  } catch (error) {
    recognition = null;
    els.voiceButton.classList.remove("listening");
    setStatus(formatVoiceError(error));
  }
}

function speakAnswer(answer, question, enabled) {
  if (!enabled) return;

  globalThis.WatchBuddyVoice?.speak(answer, {
    enabled,
    language: detectLanguage(question)
  });
}

function formatVoiceError(error) {
  const code = String(error?.name || error?.message || error || "unknown");
  if (/not-allowed|permission|denied|NotAllowedError/i.test(code)) {
    return "Microphone is blocked. Allow microphone access for WatchBuddy in Chrome, then try again.";
  }
  if (/no-speech/i.test(code)) {
    return "I did not hear anything. Try again closer to the microphone.";
  }
  if (/audio-capture/i.test(code)) {
    return "No microphone was found. Check your input device and try again.";
  }
  if (/speech-unavailable/i.test(code)) {
    return "Speech recognition is not available in this browser.";
  }
  return `Voice input failed: ${code}`;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
