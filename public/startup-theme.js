(function () {
  var mode = 'system';
  var language = navigator.language && navigator.language.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';

  try {
    var storedMode = window.localStorage.getItem('clawchat-theme-mode');
    if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'system') {
      mode = storedMode;
    }
    var storedLanguage = window.localStorage.getItem('clawchat-language');
    if (storedLanguage === 'en' || storedLanguage === 'ko') {
      language = storedLanguage;
    }
  } catch (_error) {
    // Storage can be unavailable in private or restricted WebViews.
  }

  var systemDark = false;
  try {
    systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (_error) {
    // Light is the safe fallback when matchMedia is unavailable.
  }

  var theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  document.documentElement.dataset.ccTheme = theme;
  document.documentElement.lang = language;
  document.documentElement.style.colorScheme = theme;

  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', theme === 'dark' ? '#111316' : '#F7F8FA');
  }
})();
