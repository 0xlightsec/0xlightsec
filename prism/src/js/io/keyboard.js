/**
 * Computer keyboard as an instrument.
 *
 * While the app window is focused the keyboard is CAPTURED: the note keys play
 * notes and their default behaviour is suppressed. The BREAKAWAY key breaks out of
 * that capture and hands the keyboard back to the OS, so you can type, tab away or
 * use shortcuts normally. Re-arm with Enter or by clicking the stage.
 */

export const WHITE_KEYS = [
  { code: 'KeyA', label: 'A', semitone: 0 },
  { code: 'KeyS', label: 'S', semitone: 2 },
  { code: 'KeyD', label: 'D', semitone: 4 },
  { code: 'KeyF', label: 'F', semitone: 5 },
  { code: 'KeyG', label: 'G', semitone: 7 },
  { code: 'KeyH', label: 'H', semitone: 9 },
  { code: 'KeyJ', label: 'J', semitone: 11 },
  { code: 'KeyK', label: 'K', semitone: 12 },
  { code: 'KeyL', label: 'L', semitone: 14 },
  { code: 'Semicolon', label: ';', semitone: 16 },
  { code: 'Quote', label: "'", semitone: 17 }
];

// `after` is the index of the white key the black key sits on top of.
export const BLACK_KEYS = [
  { code: 'KeyW', label: 'W', semitone: 1, after: 0 },
  { code: 'KeyE', label: 'E', semitone: 3, after: 1 },
  { code: 'KeyT', label: 'T', semitone: 6, after: 3 },
  { code: 'KeyY', label: 'Y', semitone: 8, after: 4 },
  { code: 'KeyU', label: 'U', semitone: 10, after: 5 },
  { code: 'KeyO', label: 'O', semitone: 13, after: 7 },
  { code: 'KeyP', label: 'P', semitone: 15, after: 8 }
];

export const KEY_SEMITONES = new Map(
  [...WHITE_KEYS, ...BLACK_KEYS].map((k) => [k.code, k.semitone])
);

export const BREAKAWAY_CODE = 'Escape';
export const REARM_CODES = new Set(['Enter', 'NumpadEnter']);

const OCTAVE_DOWN = 'KeyZ';
const OCTAVE_UP = 'KeyX';
const VELOCITY_DOWN = 'Comma';
const VELOCITY_UP = 'Period';

export class KeyboardInstrument {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.captured = true;     // keyboard belongs to the instrument
    this.focused = true;      // the app window has OS focus
    this.octave = 4;          // octave of the leftmost key (A -> C4)
    this.velocity = 0.8;
    this.down = new Map();    // code -> midi
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onKeyUp = this.onKeyUp.bind(this);
  }

  attach(target = window) {
    target.addEventListener('keydown', this._onKeyDown, { capture: true });
    target.addEventListener('keyup', this._onKeyUp, { capture: true });
  }

  detach(target = window) {
    target.removeEventListener('keydown', this._onKeyDown, { capture: true });
    target.removeEventListener('keyup', this._onKeyUp, { capture: true });
  }

  /** Live: is the instrument actually listening right now? */
  get active() {
    return this.captured && this.focused;
  }

  midiFor(code) {
    const semitone = KEY_SEMITONES.get(code);
    if (semitone === undefined) return null;
    const midi = (this.octave + 1) * 12 + semitone;
    return midi >= 0 && midi <= 127 ? midi : null;
  }

  setFocused(focused) {
    if (this.focused === focused) return;
    this.focused = focused;
    if (!focused) this.releaseAll();
    this.handlers.onState?.(this.state());
  }

  /** The breakaway: hand the keyboard back to the OS. */
  breakaway() {
    if (!this.captured) return;
    this.captured = false;
    this.releaseAll();
    this.handlers.onBreakaway?.();
    this.handlers.onState?.(this.state());
  }

  /** Take the keyboard back. */
  rearm() {
    if (this.captured) return;
    this.captured = true;
    this.handlers.onRearm?.();
    this.handlers.onState?.(this.state());
  }

  toggleCapture() {
    this.captured ? this.breakaway() : this.rearm();
  }

  setOctave(octave) {
    const next = Math.max(0, Math.min(8, octave));
    if (next === this.octave) return;
    this.releaseAll();
    this.octave = next;
    this.handlers.onState?.(this.state());
  }

  setVelocity(v) {
    this.velocity = Math.max(0.05, Math.min(1, v));
    this.handlers.onState?.(this.state());
  }

  onKeyDown(event) {
    // The breakaway key works whenever the window is focused, captured or not.
    if (event.code === BREAKAWAY_CODE && this.captured && this.focused) {
      event.preventDefault();
      this.breakaway();
      return;
    }
    if (!this.captured && this.focused && REARM_CODES.has(event.code) && !isTyping(event.target)) {
      event.preventDefault();
      this.rearm();
      return;
    }
    if (!this.active || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    if (event.code === OCTAVE_DOWN) { event.preventDefault(); this.setOctave(this.octave - 1); return; }
    if (event.code === OCTAVE_UP) { event.preventDefault(); this.setOctave(this.octave + 1); return; }
    if (event.code === VELOCITY_DOWN) { event.preventDefault(); this.setVelocity(this.velocity - 0.1); return; }
    if (event.code === VELOCITY_UP) { event.preventDefault(); this.setVelocity(this.velocity + 0.1); return; }

    const midi = this.midiFor(event.code);
    if (midi === null) return;

    event.preventDefault();
    if (event.repeat || this.down.has(event.code)) return;
    this.down.set(event.code, midi);
    this.handlers.onNoteOn?.(midi, this.velocity, event.code);
    this.handlers.onState?.(this.state());
  }

  onKeyUp(event) {
    const midi = this.down.get(event.code);
    if (midi === undefined) return;
    this.down.delete(event.code);
    if (KEY_SEMITONES.has(event.code)) event.preventDefault();
    this.handlers.onNoteOff?.(midi, event.code);
    this.handlers.onState?.(this.state());
  }

  releaseAll() {
    for (const [code, midi] of [...this.down]) {
      this.down.delete(code);
      this.handlers.onNoteOff?.(midi, code);
    }
    this.handlers.onState?.(this.state());
  }

  /** Press/release from the on-screen keys (mouse or touch). */
  pressVirtual(code) {
    if (this.down.has(code)) return;
    const midi = this.midiFor(code);
    if (midi === null) return;
    this.down.set(code, midi);
    this.handlers.onNoteOn?.(midi, this.velocity, code);
    this.handlers.onState?.(this.state());
  }

  releaseVirtual(code) {
    const midi = this.down.get(code);
    if (midi === undefined) return;
    this.down.delete(code);
    this.handlers.onNoteOff?.(midi, code);
    this.handlers.onState?.(this.state());
  }

  state() {
    return {
      captured: this.captured,
      focused: this.focused,
      active: this.active,
      octave: this.octave,
      velocity: this.velocity,
      down: new Set(this.down.keys())
    };
  }
}

function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true;
}
