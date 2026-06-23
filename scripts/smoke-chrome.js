const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  const chrome = findChrome();
  if (!chrome.supportsLoadExtension && !process.env.WATCHBUDDY_ALLOW_UNSUPPORTED_CHROME) {
    console.log("Chrome smoke test skipped.");
    console.log("Google Chrome 137+ no longer supports --load-extension from the command line.");
    console.log("Install Chrome for Testing or Chromium, or set CHROME_PATH to a compatible browser.");
    return;
  }

  const port = await findFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "watchbuddy-chrome-"));
  const chromeProcess = spawn(chrome.path, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    "about:blank"
  ], {
    detached: false,
    stdio: "ignore"
  });

  try {
    await waitForChrome(port);
    const extensionId = await waitForExtensionId(profileDir, port);
    const sidepanelUrl = `chrome-extension://${extensionId}/src/sidepanel.html`;
    const target = await openDebugTarget(port, sidepanelUrl);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);

    try {
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      await cdp.waitForLoad();

      const initial = await cdp.evaluate(() => ({
        title: document.querySelector("h1")?.textContent,
        status: document.querySelector("#status")?.textContent,
        hasVoiceButton: Boolean(document.querySelector("#voiceButton")),
        hasVoiceReplies: Boolean(document.querySelector("#voiceReplies")),
        hasThemeSelect: Boolean(document.querySelector("#theme")),
        hasVoiceHelper: typeof globalThis.WatchBuddyVoice?.speak === "function",
        hasThemeHelper: typeof globalThis.WatchBuddyTheme?.apply === "function"
      }));

      assertEqual(initial.title, "WatchBuddy", "sidepanel title");
      assert(initial.hasVoiceButton, "voice button is missing");
      assert(initial.hasVoiceReplies, "voice reply setting is missing");
      assert(initial.hasThemeSelect, "theme select is missing");
      assert(initial.hasVoiceHelper, "voice helper did not load");
      assert(initial.hasThemeHelper, "theme helper did not load");

      const themeResult = await cdp.evaluate(() => {
        const settingsButton = document.querySelector("#settingsButton");
        const theme = document.querySelector("#theme");
        settingsButton.click();
        theme.value = "dark";
        theme.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          dataTheme: document.documentElement.dataset.theme,
          colorScheme: document.documentElement.style.colorScheme
        };
      });

      assertEqual(themeResult.dataTheme, "dark", "dark theme data attribute");
      assertEqual(themeResult.colorScheme, "dark", "dark theme color scheme");

      const enterResult = await cdp.evaluate(async () => {
        const question = document.querySelector("#question");
        question.value = "ping";
        question.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true
        }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        return [...document.querySelectorAll(".message")].map((node) => ({
          className: node.className,
          text: node.textContent
        }));
      });

      assert(enterResult.some((message) => message.className.includes("user") && message.text === "ping"), "Enter did not submit the textarea");

      const voiceError = await cdp.evaluate(() => globalThis.formatVoiceError?.("not-allowed"));
      assert(/Microphone is blocked/.test(voiceError || ""), "not-allowed microphone error is not user-friendly");

      const seriousLogs = cdp.logs.filter((entry) => entry.level === "error");
      assert(!seriousLogs.length, `console errors found: ${JSON.stringify(seriousLogs)}`);

      console.log("Chrome smoke test passed.");
      console.log(`Extension ID: ${extensionId}`);
    } finally {
      cdp.close();
    }
  } finally {
    chromeProcess.kill();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

function findChrome() {
  const candidates = [
    { path: process.env.CHROME_PATH, supportsLoadExtension: true },
    { path: "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", supportsLoadExtension: true },
    { path: "/Applications/Chromium.app/Contents/MacOS/Chromium", supportsLoadExtension: true },
    { path: "C:\\Program Files\\Google\\Chrome for Testing\\Application\\chrome.exe", supportsLoadExtension: true },
    { path: "C:\\Program Files\\Chromium\\Application\\chrome.exe", supportsLoadExtension: true },
    { path: "/usr/bin/chromium", supportsLoadExtension: true },
    { path: "/usr/bin/chromium-browser", supportsLoadExtension: true },
    { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", supportsLoadExtension: false },
    { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", supportsLoadExtension: false },
    { path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", supportsLoadExtension: false },
    { path: "/usr/bin/google-chrome", supportsLoadExtension: false },
    { path: "/usr/bin/google-chrome-stable", supportsLoadExtension: false }
  ].filter((candidate) => candidate.path);

  const found = candidates.find((candidate) => fs.existsSync(candidate.path));
  if (!found) {
    throw new Error("Chrome was not found. Set CHROME_PATH to run this smoke test.");
  }
  return found;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForChrome(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (_error) {
      await sleep(200);
    }
  }
  throw new Error("Chrome did not start with remote debugging.");
}

async function waitForExtensionId(profileDir, port) {
  const prefsPath = path.join(profileDir, "Default", "Preferences");
  const deadline = Date.now() + 15000;
  let knownExtensions = [];

  while (Date.now() < deadline) {
    if (fs.existsSync(prefsPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
      const settings = prefs.extensions?.settings || {};
      knownExtensions = Object.entries(settings).map(([id, value]) => ({
        id,
        name: value.manifest?.name,
        path: value.path,
        state: value.state
      }));
      const found = Object.entries(settings).find(([, value]) => {
        const extensionPath = value.path ? path.resolve(value.path) : "";
        return value.state !== 0 && (
          extensionPath === repoRoot
          || value.manifest?.name === "WatchBuddy"
        );
      });
      if (found) return found[0];
    }

    const targetId = await findExtensionIdFromTargets(port);
    if (targetId) return targetId;

    await sleep(200);
  }

  throw new Error(`Loaded extension ID was not found in the Chrome profile. Known extensions: ${JSON.stringify(knownExtensions)}`);
}

async function findExtensionIdFromTargets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return "";
    const targets = await response.json();
    const match = targets
      .map((target) => target.url || "")
      .filter((url) => url.includes("/src/background.js") || url.includes("/src/sidepanel.html"))
      .map((url) => url.match(/^chrome-extension:\/\/([^/]+)\//))
      .find(Boolean);
    return match?.[1] || "";
  } catch (_error) {
    return "";
  }
}

async function openDebugTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(`Failed to open debug target (${response.status}).`);
  }
  return response.json();
}

function connectCdp(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const waiters = [];
  const api = {
    logs: [],
    close() {
      ws.close();
    },
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    evaluate(fn) {
      return api.send("Runtime.evaluate", {
        expression: `(${fn})()`,
        awaitPromise: true,
        returnByValue: true
      }).then((result) => {
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.text || "Evaluation failed");
        }
        return result.result.value;
      });
    },
    waitForLoad() {
      return new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 3000);
      });
    }
  };

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }

    if (message.method === "Runtime.consoleAPICalled") {
      api.logs.push({
        level: message.params.type,
        text: (message.params.args || []).map((arg) => arg.value || arg.description || "").join(" ")
      });
    }

    if (message.method === "Runtime.exceptionThrown") {
      api.logs.push({
        level: "error",
        text: message.params.exceptionDetails?.text || "Runtime exception"
      });
    }

    if (message.method === "Page.loadEventFired" || message.method === "Page.domContentEventFired") {
      while (waiters.length) waiters.shift()();
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(api), { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed.")), { once: true });
  });
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
