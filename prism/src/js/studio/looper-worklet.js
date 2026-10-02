/** Audio-thread host for the looper: mono in, one mono output per layer, status posted ~30x a second. */

import { LoopCore, MAX_LAYERS } from './looper.js';

class PrismLooper extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new LoopCore(sampleRate);
    this.core.frame = currentFrame;
    this.sinceStatus = 0;
    this.slots = [];
    this.port.onmessage = (e) => {
      const d = e.data;
      if ('latency' in d) this.core.latency = Math.max(0, Math.round(d.latency));
      // The beat grid: bar length in frames and the frame of one downbeat (0 = no beat).
      if ('barSamples' in d) this.core.barSamples = Math.max(0, d.barSamples);
      if ('origin' in d) this.core.origin = d.origin;
      if (d.cmd === 'press') this.core.press();
      if (d.cmd === 'undo') this.core.undo();
      if (d.cmd === 'redo') this.core.redo();
      if (d.cmd === 'clear') this.core.clear();
      if (d.cmd === 'stop') this.core.toggleStop();
      if (d.cmd || 'barSamples' in d) this.port.postMessage(this.core.status());
    };
  }

  process(inputs, outputs) {
    const n = outputs[0][0].length;
    for (let k = 0; k < MAX_LAYERS; k++) this.slots[k] = outputs[k][0];
    this.core.process(inputs[0]?.[0], this.slots, n, currentFrame);
    this.sinceStatus += n;
    if (this.sinceStatus >= 1536) {
      this.sinceStatus = 0;
      this.port.postMessage(this.core.status());
    }
    return true;
  }
}

registerProcessor('prism-looper', PrismLooper);
