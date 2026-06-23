(() => {
const DEFAULT_THEME = "system";
const VALID_THEMES = new Set(["system", "light", "dark"]);

function apply(theme = DEFAULT_THEME) {
  const selected = VALID_THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = selected;
  document.documentElement.style.colorScheme = selected === "system" ? "light dark" : selected;
}

globalThis.WatchBuddyTheme = {
  apply,
  defaultTheme: DEFAULT_THEME
};
})();
