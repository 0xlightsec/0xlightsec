/** Audio-thread host for LiveCircles: stereo out, left = X, right = Y. */

import { LiveCircles } from './live.js';

class PrismLive extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gen = new LiveCircles(sampleRate);
    this.active = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if ('active' in d) this.active = d.active;
      if (d.targets) this.gen.setTargets(d.targets, d.f);
    };
  }

  process(_inputs, outputs) {
    if (this.active) {
      const [left, right] = outputs[0];
      this.gen.render(left, right ?? left, left.length);
    }
    return true;
  }
}

registerProcessor('prism-live', PrismLive);
