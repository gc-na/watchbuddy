const MAX_TEXT_CHARS = 12000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "WATCHBUDDY_GET_CONTEXT") return false;

  Promise.resolve(getWatchContext())
    .then((context) => sendResponse({ ok: true, context }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

function getWatchContext() {
  const video = findActiveVideo();
  const platform = detectPlatform();
  const transcript = collectTranscript(platform, video?.currentTime ?? 0);
  const pageText = compactText(document.body?.innerText || "").slice(0, MAX_TEXT_CHARS);

  return {
    platform,
    url: location.href,
    title: document.title,
    currentTime: video ? video.currentTime : null,
    duration: video ? video.duration : null,
    paused: video ? video.paused : null,
    transcript,
    pageText
  };
}

function findActiveVideo() {
  const videos = [...document.querySelectorAll("video")];
  if (!videos.length) return null;

  return videos
    .filter((video) => Number.isFinite(video.duration))
    .sort((a, b) => {
      const aScore = (a.paused ? 0 : 10) + a.clientWidth * a.clientHeight;
      const bScore = (b.paused ? 0 : 10) + b.clientWidth * b.clientHeight;
      return bScore - aScore;
    })[0];
}

function detectPlatform() {
  const host = location.hostname;
  if (host.includes("youtube.com")) return "YouTube";
  if (host.includes("netflix.com")) return "Netflix";
  if (host.includes("udemy.com")) return "Udemy";
  if (host.includes("coursera.org")) return "Coursera";
  return "Video page";
}

function collectTranscript(platform, currentTime) {
  const textTrackText = collectTextTracks(currentTime);
  const pageTranscript = platform === "YouTube"
    ? collectYouTubeTranscript()
    : collectLikelyTranscriptNodes();

  const visibleCaptions = collectVisibleCaptions();
  const chunks = [textTrackText, visibleCaptions, pageTranscript].filter(Boolean);
  return compactText(chunks.join("\n\n")).slice(0, MAX_TEXT_CHARS);
}

function collectTextTracks(currentTime) {
  const video = findActiveVideo();
  if (!video?.textTracks?.length) return "";

  const snippets = [];
  for (const track of video.textTracks) {
    try {
      track.mode = "hidden";
      const cues = [...(track.cues || [])];
      for (const cue of cues) {
        if (Math.abs((cue.startTime || 0) - currentTime) <= 180) {
          snippets.push(`[${formatTime(cue.startTime)}] ${cue.text}`);
        }
      }
    } catch (_error) {
      // Some platforms block text track access. Other extraction paths still work.
    }
  }
  return snippets.join("\n");
}

function collectYouTubeTranscript() {
  const candidates = [
    ...document.querySelectorAll("ytd-transcript-segment-renderer"),
    ...document.querySelectorAll("[class*='transcript']"),
    ...document.querySelectorAll("yt-formatted-string")
  ];

  return compactText(
    candidates
      .map((node) => node.innerText || node.textContent || "")
      .filter((text) => text.trim().length > 20)
      .join("\n")
  );
}

function collectLikelyTranscriptNodes() {
  const selectors = [
    "[class*='transcript']",
    "[class*='caption']",
    "[class*='subtitle']",
    "[data-purpose*='transcript']",
    "[aria-label*='transcript' i]",
    "[aria-label*='caption' i]"
  ];

  return compactText(
    selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((node) => node.innerText || node.textContent || "")
      .filter((text) => text.trim().length > 20)
      .join("\n")
  );
}

function collectVisibleCaptions() {
  const selectors = [
    ".ytp-caption-segment",
    "[class*='player-timedtext']",
    "[class*='caption-window']",
    "[class*='subtitle']"
  ];

  return compactText(
    selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((node) => node.innerText || node.textContent || "")
      .filter(Boolean)
      .join("\n")
  );
}

function compactText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
