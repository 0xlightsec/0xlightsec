/** Audio-thread host for the performance pads (stutter, tape stop): stereo in, stereo out. */

import { PerfCore } from './perf.js';

class PrismPerf extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new PerfCore(sampleRate);
    this.core.frame = currentFrame;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.grid) this.core.setGrid(d.grid.step, d.grid.origin);
      if ('stutter' in d) this.core.stutter(d.stutter);
      if ('tape' in d) this.core.tape(d.tape);
    };
  }

  process(inputs, outputs) {
    const [inL, inR] = inputs[0] ?? [];
    const [outL, outR] = outputs[0];
    this.core.process(inL, inR ?? inL, outL, outR ?? outL, outL.length, currentFrame);
    return true;
  }
}

registerProcessor('prism-perf', PrismPerf);
