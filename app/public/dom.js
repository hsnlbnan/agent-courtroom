// Shared DOM helpers. Text is only ever inserted as text nodes; `icon` takes
// constant SVG markup defined in source, never model output.
export const $ = (s, root = document) => root.querySelector(s);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export function icon(paths, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = paths;
  return s;
}

export const STANCE = {
  challenge: { label: 'İtiraz', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>' },
  question: { label: 'Soru', icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.6 1.3c0 1.7-2.1 2-2.1 3.4M12 17v.01"/>' },
  agree: { label: 'Katılıyor', icon: '<path d="M5 12.5l4.5 4.5L19 7.5"/>' },
  build: { label: 'Üstüne koyuyor', icon: '<path d="M12 5v14M5 12h14"/>' },
  concede: { label: 'Kabul ediyor', icon: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>' },
};
export const VOTE = { go: 'go', 'no-go': 'no-go', conditional: 'koşullu' };

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Restart a one-shot CSS animation class.
export function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
