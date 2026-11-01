// Applies a saved light/dark choice before the first paint, so the page never flashes the
// other theme. An external file because the CSP allows no inline scripts.
try {
  var t = localStorage.getItem('council-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
