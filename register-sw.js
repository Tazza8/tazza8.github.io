// Split out of index.html so the page can run under a strict script-src CSP
// with no 'unsafe-inline' exception needed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
