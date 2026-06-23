(() => {
if (globalThis.__WATCHBUDDY_CONTENT_LOADED__) {
  return;
}
globalThis.__WATCHBUDDY_CONTENT_LOADED__ = true;

const MAX_TEXT_CHARS = 12000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "WATCHBUDDY_GET_CONTEXT") return false;

  Promise.resolve(getWatchContext())
    .then((context) => sendResponse({ ok: true, context }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function getWatchContext() {
  const video = findActiveVideo();
  const platform = detectPlatform();
  const currentTime = video?.currentTime ?? 0;
  const transcript = await collectTranscript(platform, currentTime);
  const transcriptRows = parseTimedTranscriptText(transcript);
  const nearbyRows = selectNearbyRows(transcriptRows, currentTime, 90);
  const currentRow = findCurrentRow(transcriptRows, currentTime);
  const pageText = compactText(document.body?.innerText || "").slice(0, MAX_TEXT_CHARS);

  return {
    platform,
    url: location.href,
    title: document.title,
    metadata: collectPageMetadata(platform),
    currentTime: video ? video.currentTime : null,
    duration: video ? video.duration : null,
    paused: video ? video.paused : null,
    transcript,
    transcriptRows: nearbyRows,
    currentTranscript: currentRow ? `[${currentRow.time}] ${currentRow.text}` : "",
    nearbyTranscript: nearbyRows.map((row) => `[${row.time}] ${row.text}`).join("\n"),
    transcriptPreview: summarizeTranscriptPreview(transcript, currentTime),
    pageText
  };
}

function collectPageMetadata(platform) {
  const base = {
    description: getMetaContent("description"),
    keywords: getMetaContent("keywords"),
    ogTitle: getMetaContent("og:title"),
    ogDescription: getMetaContent("og:description")
  };

  if (platform !== "YouTube") return base;

  return {
    ...base,
    channel: compactText(document.querySelector("ytd-channel-name, #owner #channel-name, #text.ytd-channel-name")?.innerText || ""),
    description: compactText([
      base.description,
      document.querySelector("#description-inline-expander, ytd-text-inline-expander, #description, #description-text")?.innerText || ""
    ].filter(Boolean).join("\n")).slice(0, 2400),
    hashtags: [...document.querySelectorAll("a[href^='/hashtag/']")]
      .map((node) => compactText(node.innerText || node.textContent || ""))
      .filter(Boolean)
      .slice(0, 12)
  };
}

function getMetaContent(name) {
  return document.querySelector(`meta[name='${name}'], meta[property='${name}']`)?.getAttribute("content") || "";
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
  if (host.includes("bilibili.com")) return "Bilibili";
  return "Video page";
}

async function collectTranscript(platform, currentTime) {
  const textTrackText = collectTextTracks(currentTime);
  if (platform === "YouTube") {
    await ensureYouTubeTranscriptOpen();
  }

  const pageTranscript = platform === "YouTube"
    ? collectYouTubeTranscript(currentTime)
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

function collectYouTubeTranscript(currentTime) {
  const timedRows = collectYouTubeTimedTranscriptRows();
  if (timedRows.length) {
    return formatTimedTranscriptRows(timedRows, currentTime);
  }

  const transcriptContainers = [
    ...document.querySelectorAll("ytd-transcript-renderer"),
    ...document.querySelectorAll("ytd-transcript-search-panel-renderer"),
    ...document.querySelectorAll("ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']"),
    ...document.querySelectorAll("[class*='transcript']")
  ];

  const containerText = compactText(
    transcriptContainers
      .map((node) => node.innerText || node.textContent || "")
      .filter((text) => text.trim().length > 8)
      .join("\n")
  );

  if (containerText) return containerText;

  return compactText(
    [...document.querySelectorAll("yt-formatted-string")]
      .map((node) => node.innerText || node.textContent || "")
      .filter((text) => text.trim().length > 5)
      .join("\n")
  );
}

function collectYouTubeTimedTranscriptRows() {
  const selectors = [
    "ytd-transcript-segment-renderer",
    "ytm-transcript-segment-renderer",
    "macro-markers-panel-item-view-model[role='button']",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] macro-markers-panel-item-view-model",
    "ytd-transcript-segment-list-renderer [role='button']",
    "ytd-transcript-segment-list-renderer button",
    "ytd-transcript-search-panel-renderer [role='button']",
    "ytd-transcript-search-panel-renderer button",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] [role='button']",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] button",
    "#panels macro-markers-panel-item-view-model[role='button']",
    "#panels [role='button']",
    "[class*='transcript'] [role='button']",
    "[class*='transcript'] button"
  ];

  const rows = [];
  const seen = new Set();
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const text = compactText(node.innerText || node.textContent || "");
      const row = parseTranscriptRow(text);
      if (!row) continue;

      const key = `${row.time}|${row.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return rows.sort((a, b) => a.seconds - b.seconds);
}

function parseTranscriptRow(text) {
  if (!text) return null;

  const match = text.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?:\s|$)([\s\S]*)/);
  if (!match) return null;

  const rawText = compactText(text.replace(match[1], ""));
  const rowText = compactText(rawText.replace(/^\d{1,2}분\s*(?:\d{1,2}초)?\s*/, "").replace(/^\d{1,2}초\s*/, ""));
  if (!rowText) return null;

  return {
    time: match[1],
    seconds: parseTimestamp(match[1]),
    text: rowText
  };
}

async function ensureYouTubeTranscriptOpen() {
  if (collectYouTubeTimedTranscriptRows().length) return;

  const showTranscriptButton = findButtonByText(["스크립트 표시", "Show transcript"]);
  if (showTranscriptButton) {
    showTranscriptButton.click();
    await wait(1200);
    return;
  }

  const expandDescriptionButton = findButtonByText(["...더보기", "더보기", "...more", "more"]);
  if (expandDescriptionButton) {
    expandDescriptionButton.click();
    await wait(700);
  }

  const retryButton = findButtonByText(["스크립트 표시", "Show transcript"]);
  if (retryButton) {
    retryButton.click();
    await wait(1200);
  }
}

function findButtonByText(labels) {
  const buttons = [...document.querySelectorAll("button, [role='button']")];
  return buttons.find((button) => {
    const text = compactText(button.innerText || button.textContent || button.getAttribute("aria-label") || "");
    return labels.some((label) => text.toLowerCase().includes(label.toLowerCase()));
  });
}

function formatTimedTranscriptRows(rows, currentTime) {
  const nearbyRows = rows.filter((row) => Math.abs(row.seconds - currentTime) <= 240);
  const selectedRows = nearbyRows.length >= 4 ? nearbyRows : rows;

  return selectedRows
    .map((row) => `[${row.time}] ${row.text}`)
    .join("\n");
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

function summarizeTranscriptPreview(transcript, currentTime) {
  const lines = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const nearby = lines.filter((line) => {
    const match = line.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
    return match && Math.abs(parseTimestamp(match[1]) - currentTime) <= 90;
  });

  return (nearby.length ? nearby : lines).slice(0, 8).join("\n");
}

function parseTimedTranscriptText(transcript) {
  return transcript
    .split("\n")
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
      if (!match) return null;
      return {
        time: match[1],
        seconds: parseTimestamp(match[1]),
        text: match[2].trim()
      };
    })
    .filter(Boolean);
}

function selectNearbyRows(rows, currentTime, windowSeconds) {
  const foundIndex = rows.findIndex((row) => row.seconds >= currentTime);
  const currentIndex = foundIndex === -1 ? rows.length - 1 : Math.max(0, foundIndex);
  const centeredRows = rows.slice(Math.max(0, currentIndex - 10), currentIndex + 16);
  const nearby = centeredRows.filter((row) => Math.abs(row.seconds - currentTime) <= windowSeconds);
  if (nearby.length) return nearby;

  return rows.slice(Math.max(0, currentIndex - 8), currentIndex + 12);
}

function findCurrentRow(rows, currentTime) {
  if (!rows.length) return null;

  let best = rows[0];
  for (const row of rows) {
    if (row.seconds <= currentTime + 3) {
      best = row;
    }
  }
  return best;
}

function parseTimestamp(timestamp) {
  const parts = timestamp.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
})();
