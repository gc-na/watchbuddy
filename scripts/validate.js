const fs = require("fs");
const vm = require("vm");
const { execFileSync } = require("child_process");

execFileSync(process.execPath, ["--check", "src/background.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/content.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/sidepanel.js"], { stdio: "inherit" });

JSON.parse(fs.readFileSync("manifest.json", "utf8"));

const noopEl = () => ({
  value: "",
  textContent: "",
  hidden: false,
  disabled: false,
  classList: { add() {}, remove() {} },
  append() {},
  addEventListener() {},
  scrollTop: 0,
  scrollHeight: 0
});

const context = {
  console,
  setTimeout,
  clearTimeout,
  navigator: { language: "ko-KR" },
  globalThis: {},
  document: {
    querySelector: () => noopEl(),
    createElement: () => noopEl()
  },
  chrome: {
    storage: { sync: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({ ok: false }) }
  }
};

context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/sidepanel.js", "utf8"), context);

const sample = {
  platform: "YouTube",
  title: "한국인 제발 와주세요😭 돈까지 뿌리는 일본 소도시, 연차 없이 1박2일 - YouTube",
  url: "https://youtube.com/watch?v=test",
  currentTime: 16 * 60 + 51,
  duration: 44 * 60 + 34,
  metadata: {
    description: "오늘은 아마도 현 시점 한국인을 가장 환영하는... 일본 시코쿠의 소도시 마쓰야마를 다녀왔습니다.",
    ogDescription: "일본 시코쿠의 소도시 마쓰야마 여행",
    channel: "폭간트",
    hashtags: ["#폭간트", "#마쓰야마", "#일본", "#소도시"]
  },
  transcript: [
    "[16:59] 버려 하시겠지만 일본은 부산 모여서는 참 정소하는 그런 느낌이 있다.",
    "[17:03] 일본의 뒷면은 다 한국이랑 똑같아. 사람들이 앞에 형님 한 분이 낚시하고 계시거든요.",
    "[17:37] 철길과 레일을 따라서 무작정 걷다가 여기 약간 언덕이 나와.",
    "[17:45] 표지판을 봤거든요. 역사 좋아하시는 분들은 다들 아실 거예요."
  ].join("\n"),
  transcriptPreview: [
    "[17:03] 일본의 뒷면은 다 한국이랑 똑같아. 사람들이 앞에 형님 한 분이 낚시하고 계시거든요.",
    "[17:37] 철길과 레일을 따라서 무작정 걷다가 여기 약간 언덕이 나와.",
    "[17:45] 표지판을 봤거든요. 역사 좋아하시는 분들은 다들 아실 거예요."
  ].join("\n"),
  pageText: "한국인 제발 와주세요 돈까지 뿌리는 일본 소도시 마쓰야마 여행"
};

const checks = {
  promptUsesKoreanRules: context.buildPrompt("여기가 어디냐", sample, "chrome-ai").includes("질문을 반복하지 말고"),
  promptIncludesMetadata: context.buildPrompt("여기가 어디냐", sample, "chrome-ai").includes("마쓰야마"),
  rejectsMusicEcho: context.needsQualityRetry("음악이 뭐지? 🎧", "이 노래가 뭐지"),
  rejectsPlaceEcho: context.needsQualityRetry("여기 여기가 어디예요?", "여기가 어디냐"),
  musicFallbackIsGrounded: context.buildFallbackAnswer("이 노래가 뭐지", sample).includes("곡명"),
  placeFallbackUsesMetadata: context.buildFallbackAnswer("여기가 어디냐", sample).includes("마쓰야마")
};

const failures = Object.entries(checks).filter(([, passed]) => !passed);
if (failures.length) {
  console.error("Validation failed:");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("Validation passed.");
