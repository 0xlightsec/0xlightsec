/**
 * A rotary knob: drag up or down (or sideways), scroll, or use the arrow keys.
 * Double-click puts it back where it started. Values run 0..1; `format` turns
 * them into the label shown under the knob.
 */

const SWEEP = 270; // degrees from minimum to maximum
const SIZE = 52;
const R = 20;

const polar = (deg, r = R) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [SIZE / 2 + r * Math.cos(a), SIZE / 2 + r * Math.sin(a)];
};

function arc(from, to) {
  if (Math.abs(to - from) < 0.01) return '';
  const [x0, y0] = polar(from);
  const [x1, y1] = polar(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Knob {
  /**
   * @param {HTMLElement} el      container; gets the knob, label and value
   * @param {object} opts         { label, value, def, bipolar, format, onChange, hue }
   */
  constructor(el, { label, value = 0, def = value, bipolar = false, format = (v) => `${Math.round(v * 100)}`, onChange, hue = 314 }) {
    this.el = el;
    this.def = def;
    this.bipolar = bipolar;
    this.format = format;
    this.onChange = onChange;
    el.classList.add('knob');
    el.style.setProperty('--knob-hue', String(hue));
    el.innerHTML = `
      <div class="knob-dial" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
        <svg viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">
          <path class="knob-track" d="${arc(-SWEEP / 2, SWEEP / 2)}"/>
          <path class="knob-fill" d=""/>
          <line class="knob-pointer" x1="${SIZE / 2}" y1="${SIZE / 2}" x2="${SIZE / 2}" y2="${SIZE / 2 - R + 5}"/>
        </svg>
      </div>
      <span class="knob-label">${label}</span>
      <span class="knob-value"></span>`;
    this.dial = el.querySelector('.knob-dial');
    this.fill = el.querySelector('.knob-fill');
    this.pointer = el.querySelector('.knob-pointer');
    this.valueEl = el.querySelector('.knob-value');
    this.wire();
    this.set(value, false);
  }

  set(v, notify = true) {
    const next = Math.min(1, Math.max(0, v));
    this.value = next;
    const deg = -SWEEP / 2 + next * SWEEP;
    const from = this.bipolar ? 0 : -SWEEP / 2;
    this.fill.setAttribute('d', arc(Math.min(from, deg), Math.max(from, deg)));
    this.pointer.setAttribute('transform', `rotate(${deg} ${SIZE / 2} ${SIZE / 2})`);
    this.valueEl.textContent = this.format(next);
    this.dial.setAttribute('aria-valuenow', String(Math.round(next * 100)));
    this.dial.setAttribute('aria-valuetext', this.format(next));
    this.el.classList.toggle('is-active', Math.abs(next - this.def) > 0.005);
    if (notify) this.onChange?.(next);
  }

  wire() {
    const dial = this.dial;
    let last = null;
    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dial.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      this.el.classList.add('is-turning');
    });
    dial.addEventListener('pointermove', (e) => {
      if (!last) return;
      // Up and right turn it up; 160 px is the full sweep, finer with Shift.
      const d = (last.y - e.clientY + (e.clientX - last.x)) / (e.shiftKey ? 800 : 160);
      last = { x: e.clientX, y: e.clientY };
      if (d) this.set(this.value + d);
    });
    const end = () => {
      last = null;
      this.el.classList.remove('is-turning');
    };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
    dial.addEventListener('lostpointercapture', end);
    dial.addEventListener('dblclick', () => this.set(this.def));
    dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.set(this.value - Math.sign(e.deltaY) * 0.04);
    }, { passive: false });
    dial.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.set(this.value + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.set(this.value - step);
      else if (e.key === 'Home') this.set(0);
      else if (e.key === 'End') this.set(1);
      else return;
      e.preventDefault();
      e.stopPropagation(); // arrows on a knob turn the knob, nothing else
    });
  }
}
