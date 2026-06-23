(() => {
let speakingUtterance = null;

function getRecognitionConstructor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function createRecognizer({ language, onStart, onText, onError, onEnd }) {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) {
    throw new Error("speech-unavailable");
  }

  const recognition = new Recognition();
  recognition.lang = language || navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => onStart?.();
  recognition.onresult = (event) => {
    const transcript = [...event.results]
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    onText?.(transcript);
  };
  recognition.onerror = (event) => onError?.(event.error || "unknown");
  recognition.onend = () => onEnd?.();

  return recognition;
}

function speak(text, { enabled = true, language } = {}) {
  if (!enabled || !text || !globalThis.speechSynthesis) {
    return false;
  }

  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(cleanSpeechText(text));
  utterance.lang = toSpeechLanguage(language || navigator.language || "en-US");

  const voice = pickVoice(utterance.lang);
  if (voice) {
    utterance.voice = voice;
  }

  speakingUtterance = utterance;
  utterance.onend = () => {
    if (speakingUtterance === utterance) {
      speakingUtterance = null;
    }
  };
  utterance.onerror = utterance.onend;

  speechSynthesis.speak(utterance);
  return true;
}

function stopSpeaking() {
  if (globalThis.speechSynthesis?.speaking || globalThis.speechSynthesis?.pending) {
    globalThis.speechSynthesis.cancel();
  }
  speakingUtterance = null;
}

function pickVoice(language) {
  const voices = globalThis.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;

  const baseLanguage = language.split("-")[0].toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase())
    || voices.find((voice) => voice.lang.toLowerCase().startsWith(`${baseLanguage}-`))
    || null;
}

function toSpeechLanguage(language) {
  if (language === "Korean") return "ko-KR";
  if (language === "English") return "en-US";
  return language || "en-US";
}

function cleanSpeechText(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_>~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

globalThis.WatchBuddyVoice = {
  createRecognizer,
  getRecognitionConstructor,
  requestMicrophoneAccess,
  speak,
  stopSpeaking
};
})();
