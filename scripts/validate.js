const fs = require("fs");
const vm = require("vm");
const { execFileSync } = require("child_process");

execFileSync(process.execPath, ["--check", "src/background.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/content.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/sidepanel.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/theme.js"], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", "src/voice.js"], { stdio: "inherit" });

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
  englishDirectiveOverridesKoreanQuestion: context.detectAnswerLanguage("영어로 답해줘. 여기가 어디냐") === "English",
  englishPromptLanguageOverride: context.buildPrompt("Please answer in English. 여기가 어디냐", sample, "chrome-ai").includes("Answer language: English"),
  englishPromptTranslatesKoreanSource: context.buildPrompt("영어로 답해줘. 여기가 어디냐", sample, "chrome-ai").includes("Write the answer in English"),
  rejectsMusicEcho: context.needsQualityRetry("음악이 뭐지? 🎧", "이 노래가 뭐지"),
  rejectsPlaceEcho: context.needsQualityRetry("여기 여기가 어디예요?", "여기가 어디냐"),
  rejectsKoreanWhenEnglishRequested: context.needsQualityRetry("제목/설명 기준으로는 일본 시코쿠 마쓰야마 쪽이에요.", "Please answer in English. 여기가 어디냐"),
  musicFallbackIsGrounded: context.buildFallbackAnswer("이 노래가 뭐지", sample).includes("곡명"),
  placeFallbackUsesMetadata: context.buildFallbackAnswer("여기가 어디냐", sample).includes("마쓰야마"),
  englishFallbackUsesEnglishPlace: context.buildFallbackAnswer("Please answer in English. 여기가 어디냐", sample).includes("Matsuyama"),
  directMeetingAnswer: context.answerDirectlyFromContext("뭐랑 만날거 같다고?", {
    ...sample,
    currentTranscript: "[30:27] 쥐하고 만날 것 같아 쥐하고 만나면 대형인데",
    nearbyTranscript: "[30:22] 뭐가 있을까 우리가 또 궁금하긴 못참지\n[30:27] 쥐하고 만날 것 같아 쥐하고 만나면 대형인데",
    transcriptPreview: "[30:27] 쥐하고 만날 것 같아 쥐하고 만나면 대형인데"
  }) === "쥐랑 만날 것 같다고 했어요.",
  directUyuniPlaceAnswer: context.answerDirectlyFromContext("여기가 어디야?", {
    ...sample,
    title: "우유니 사막 한가운데서 하룻밤을 보내면 생기는 일 - YouTube",
    metadata: {
      description: "볼리비아 우유니 사막을 횡단하며 경험한 극한의 현실",
      ogDescription: "우유니 사막 여행"
    },
    currentTranscript: "[30:55] 지금 존이 동굴 안에 완전히 들어갔습니다",
    nearbyTranscript: "[30:55] 지금 존이 동굴 안에 완전히 들어갔습니다"
  }).includes("볼리비아 우유니 사막"),
  directSituationAnswer: context.answerDirectlyFromContext("지금 무슨 얘기야?", {
    ...sample,
    currentTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다.",
    nearbyTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다.\n[3:01] 수백 명의 사람들이 주식 가격을 외치고 있었습니다."
  }).includes("파리 증권 거래소"),
  englishSituationDelegatesForTranslation: context.answerDirectlyFromContext("Answer in English. What's going on?", {
    ...sample,
    currentTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다.",
    nearbyTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다."
  }) === "",
  directParisPlaceAnswer: context.answerDirectlyFromContext("여기가 어디야?", {
    ...sample,
    title: "수학자들이 얼마나 돈을 벌고 싶은지 감도 안옴 - YouTube",
    metadata: {
      description: "뉴턴과 파리 증권 거래소, 금융 시장을 수학으로 모델링한 이야기"
    },
    currentTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다.",
    nearbyTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다."
  }).includes("프랑스 파리"),
  directParisPlaceEnglishAnswer: context.answerDirectlyFromContext("Please answer in English. 여기가 어디야?", {
    ...sample,
    title: "수학자들이 얼마나 돈을 벌고 싶은지 감도 안옴 - YouTube",
    metadata: {
      description: "뉴턴과 파리 증권 거래소, 금융 시장을 수학으로 모델링한 이야기"
    },
    currentTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다.",
    nearbyTranscript: "[2:51] 파리 증권 거래소에 들어갔는데 거기야말로 뉴턴이 말한 사람들의 광기로 가득찬 현장이었습니다."
  }).includes("Paris, France"),
  directPriceEnglishAnswer: context.answerDirectlyFromContext("Answer in English. What was the price?", {
    ...sample,
    currentTranscript: "[13:07] 그래서 이런 14만3,000원짜리 세트면 뭐 모수의 1 가격이잖아요.",
    nearbyTranscript: "[13:04] 테스팅 시그니처는 14만3,000원이에요.\n[13:07] 그래서 이런 14만3,000원짜리 세트면 뭐 모수의 1 가격이잖아요."
  }).startsWith("According to the caption"),
  voiceNotAllowedIsFriendly: context.formatVoiceError("not-allowed").includes("Microphone is blocked")
};

const failures = Object.entries(checks).filter(([, passed]) => !passed);
if (failures.length) {
  console.error("Validation failed:");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("Validation passed.");
