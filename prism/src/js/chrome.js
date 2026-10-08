/** Window chrome shared by every page: frameless-window buttons and the focus badge. */

export const bridge = window.prism ?? null;

export function wireWindowChrome() {
  if (bridge?.platform === 'darwin') document.body.classList.add('is-mac');
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('fullscreenBtn', () => bridge?.toggleFullscreen());
  on('winMin', () => bridge?.minimize());
  on('winMax', () => bridge?.toggleMaximize());
  on('winClose', () => bridge?.close());
  // F11, as the menu used to give it.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F11' && bridge) {
      e.preventDefault();
      bridge.toggleFullscreen();
    }
  });
}

/** Paint the titlebar badge from a KeyboardInstrument state. */
export function renderFocusBadge(state) {
  const badge = document.getElementById('focusBadge');
  if (!badge) return;
  const mode = !state.focused ? 'blurred' : state.captured ? 'captured' : 'released';
  badge.dataset.state = mode;
  badge.querySelector('.focus-text').textContent =
    mode === 'captured' ? 'KEYS CAPTURED' : mode === 'released' ? 'KEYS RELEASED' : 'WINDOW UNFOCUSED';
}

/** Follow OS window focus, so held keys are released when the app loses focus. */
export function trackFocus(keys) {
  window.addEventListener('blur', () => keys.setFocused(false));
  window.addEventListener('focus', () => keys.setFocused(true));
  bridge?.onFocusChange((focused) => keys.setFocused(focused));
}
