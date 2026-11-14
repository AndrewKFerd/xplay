// Make the app window feel like an app, not a web page: no DevTools shortcuts, no browser right-click
// menu (with its "Inspect"), no drag-selecting text (see css/style.css). Text boxes keep their normal
// right-click menu for copy/paste. For development, run  localStorage.setItem('xc.dev', '1')  once,
// or open the app with ?dev in the address.
let dev = false;
try { dev = localStorage.getItem('xc.dev') === '1' || new URLSearchParams(location.search).has('dev'); } catch { /* storage blocked */ }

const isTextField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');

if (!dev) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toUpperCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const devtools = e.key === 'F12'
      || (ctrl && e.shiftKey && ['I', 'J', 'C', 'K'].includes(k))   // Inspect, Console, element picker
      || (ctrl && e.altKey && ['I', 'J', 'C'].includes(k))           // macOS variants
      || (ctrl && !e.shiftKey && k === 'U');                         // view source
    if (devtools) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // The app draws its own menus on cards; everything else just gets no menu.
  document.addEventListener('contextmenu', (e) => { if (!isTextField(e.target)) e.preventDefault(); });

  // Belt and braces for drag-select: nothing outside text fields starts a selection.
  document.addEventListener('selectstart', (e) => { if (!isTextField(e.target)) e.preventDefault(); });
} else {
  document.documentElement.classList.add('dev');
}
