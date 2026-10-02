/**
 * Runs on the audio thread. Every input arrives in the same 128-sample render
 * quantum, so the channels it hands back are sample-aligned by construction —
 * which separate AnalyserNodes are not: reading two of them one after the other
 * can straddle a quantum boundary and come back hundreds of samples apart.
 *
 *   input 0  CH1 wave generator (mono)
 *   input 1  CH2 microphone (mono)
 *   input 2  music player (stereo; a mono file is duplicated to both sides)
 *
 * Samples are batched and posted to the page as four Float32Arrays:
 * [ch1, ch2, left, right].
 */

const BLOCK = 512; // a multiple of the 128-sample quantum

class PrismCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fill = 0;
    this.fresh();
  }

  fresh() {
    this.out = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];
  }

  process(inputs) {
    // A disconnected input has no channels; it reads as silence.
    const ch1 = inputs[0]?.[0];
    const mic = inputs[1]?.[0];
    const left = inputs[2]?.[0];
    const right = inputs[2]?.[1] ?? left;
    const n = 128;
    const [o0, o1, o2, o3] = this.out;
    const at = this.fill;
    for (let i = 0; i < n; i++) {
      o0[at + i] = ch1 ? ch1[i] : 0;
      o1[at + i] = mic ? mic[i] : 0;
      o2[at + i] = left ? left[i] : 0;
      o3[at + i] = right ? right[i] : 0;
    }
    this.fill += n;
    if (this.fill >= BLOCK) {
      this.port.postMessage(this.out, this.out.map((a) => a.buffer));
      this.fresh();
      this.fill = 0;
    }
    return true;
  }
}

registerProcessor('prism-capture', PrismCapture);
