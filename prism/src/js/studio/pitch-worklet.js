/** Audio-thread host for the voice's Pitch and Tune: mono in, mono out. */

import { PitchShifter } from './voice-fx.js';

class PrismPitch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.shifter = new PitchShifter(sampleRate);
    this.port.onmessage = (e) => {
      if (Number.isFinite(e.data.ratio)) this.shifter.target = Math.min(4, Math.max(0.25, e.data.ratio));
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    this.shifter.process(inputs[0]?.[0], out, out.length);
    return true;
  }
}

registerProcessor('prism-pitch', PrismPitch);
