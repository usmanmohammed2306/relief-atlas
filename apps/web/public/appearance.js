// Synchronous same-origin bootstrap, before React and the application styles.
// Keep the welcome fallback consistent with src/appearance.ts.
try {
  document.documentElement.dataset.theme = localStorage.getItem('relief-theme') === 'night' ? 'night' : 'daylight';
} catch {
  document.documentElement.dataset.theme = 'daylight';
}
if (document.documentElement.dataset.theme === 'night') {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b1512');
}
