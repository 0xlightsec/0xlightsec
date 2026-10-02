/**
 * Audio for the Studio.
 *
 *   keys ─▶ synth ──┬─────────────────────────────▶ FX ─▶ mix ─▶ limiter ─▶ master ─▶ speakers
 *                   └─ (input-latency delay) ─┐    ▲        ▲
 *   mic ─▶ trim ─┬─ voice-to-loop ────────────┴─▶ looper ─┘ │
 *                └─ headphones only ───────────────▶ FX      │
 *   beat ──────────────────────────────────────────────────┘ (clean: the timing reference)
 *
 * - The mic is never sent to the speakers unless you say you're on headphones:
 *   with speakers it would feed back. Without headphones the browser's echo
 *   cancellation is on, so the speakers aren't recorded into your loop either.
 * - The looper records dry and plays back through the FX, so turning a knob
 *   changes the whole loop live, DJ style. The beat isn't recorded; loops lock to it.
 * - Keys are delayed into the looper by the input latency, so a note played in
 *   time with what you hear lands in the same place as a note sung in time.
 * - One capture worklet sees the music, the mic and the circles in the same render
 *   quantum, as on the oscilloscope page.
 */

import { FxChain } from './fx.js';
import { Drums, barSeconds, fitTempo, TEMPO_MIN, TEMPO_MAX } from './drums.js';
import { StudioSynth } from './sounds.js';

const HISTORY = 16384;
const DEFAULT_INPUT_LATENCY = 0.012; // when the browser doesn't say

export class StudioEngine {
  constructor() {
    this.ctx = null;
    this.micOn = false;
    this.micError = null;
    this.headphones = false;
    this.voiceToLoop = true;
    this.volume = 0.8;
    this.bpm = 96;
    this.beatName = null;
    this.loop = { state: 'empty', layers: 0, progress: 0, seconds: 0, start: 0, length: 0 };
    this.onLoop = null;
    this.onStep = null;
    this.recorder = null;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  /** Build the graph. Safe to call again: only resumes after the first time. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ready;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.mix = ctx.createGain();
    this.mix.connect(this.limiter).connect(this.master).connect(ctx.destination);

    this.fx = new FxChain(ctx);
    this.fx.output.connect(this.mix);
    this.fx.setTempo(this.bpm);

    this.synthBus = ctx.createGain();
    this.synthBus.connect(this.fx.input);
    this.synth = new StudioSynth(ctx, this.synthBus);

    this.drums = new Drums(ctx, this.mix);
    this.drums.bpm = this.bpm;
    this.drums.onStep = (s, t) => this.onStep?.(s, t);

    // Everything the looper hears: the voice and (delayed) keys.
    this.loopIn = ctx.createGain();
    this.keysToLoop = ctx.createDelay(0.5);
    this.synthBus.connect(this.keysToLoop).connect(this.loopIn);

    this.trim = ctx.createGain();
    this.trim.gain.value = 1.4;
    this.voiceSend = ctx.createGain();
    this.voiceSend.gain.value = this.voiceToLoop ? 1 : 0;
    this.trim.connect(this.voiceSend).connect(this.loopIn);
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;
    this.trim.connect(this.monitor).connect(this.fx.input);

    // What the music circle follows: keys, loop and beat, before the FX.
    this.musicTap = ctx.createGain();
    this.synthBus.connect(this.musicTap);
    this.drums.out.connect(this.musicTap);

    this.spectrum = ctx.createAnalyser();
    this.spectrum.fftSize = 8192;
    this.spectrum.smoothingTimeConstant = 0.5;
    this.spectrum.minDecibels = -110;
    this.spectrum.maxDecibels = -10;
    this.limiter.connect(this.spectrum);
    this.trim.connect(this.spectrum);
    this.spectrumDb = new Float32Array(this.spectrum.frequencyBinCount);

    this.rings = [0, 1, 2, 3].map(() => new Float32Array(HISTORY));
    this.write = 0;
    this.buf1 = new Float32Array(HISTORY); // music
    this.buf2 = new Float32Array(HISTORY); // voice
    this.bufL = new Float32Array(HISTORY); // circles X
    this.bufR = new Float32Array(HISTORY); // circles Y

    const module = (path) => ctx.audioWorklet.addModule(new URL(path, import.meta.url));
    this.ready = Promise.all([
      module('../scope/capture-worklet.js'),
      module('../scope/live-worklet.js'),
      module('./looper-worklet.js')
    ]).then(() => {
      this.looper = new AudioWorkletNode(ctx, 'prism-looper', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.looper.port.onmessage = (e) => {
        this.loop = e.data;
        this.onLoop?.(e.data);
      };
      this.loopIn.connect(this.looper);
      this.looper.connect(this.fx.input);
      this.looper.connect(this.musicTap);

      this.live = new AudioWorkletNode(ctx, 'prism-live', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.live.port.postMessage({ active: true });

      const capture = new AudioWorkletNode(ctx, 'prism-capture', { numberOfInputs: 3, numberOfOutputs: 1, outputChannelCount: [1] });
      capture.port.onmessage = (e) => this.receive(e.data);
      capture.connect(ctx.destination); // silent; keeps it pulled by the graph
      this.musicTap.connect(capture, 0, 0);
      this.trim.connect(capture, 0, 1);
      this.live.connect(capture, 0, 2);
      this.updateLatency();
      this.sendGrid();
    });
    return this.ready;
  }

  /* --------------------------------- voice --------------------------------- */

  async startMic() {
    this.start();
    this.stopMic();
    try {
      // On headphones the raw signal sounds best. On speakers echo cancellation
      // keeps the speakers out of the recording.
      const clean = !this.headphones;
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: clean, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      this.micError = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'missing' : 'blocked';
      this.micOn = false;
      return false;
    }
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.trim);
    this.micOn = true;
    this.micError = null;
    this.updateLatency();
    return true;
  }

  stopMic() {
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micStream = null;
    this.micOn = false;
  }

  /** Headphones on: hear yourself through the FX. Off: never, or it would howl. */
  async setHeadphones(on) {
    this.headphones = on;
    if (this.monitor) this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    if (this.micOn) await this.startMic(); // echo cancellation only applies when opening the mic
  }

  setVoiceToLoop(on) {
    this.voiceToLoop = on;
    if (this.voiceSend) this.voiceSend.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  /** Round trip from the speakers to your ears and back in through the mic. */
  get latencySeconds() {
    if (!this.ctx) return 0;
    return (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0) + this.inputLatency;
  }

  get inputLatency() {
    const reported = this.micStream?.getAudioTracks()[0]?.getSettings?.().latency;
    return Number.isFinite(reported) && reported > 0 ? reported : DEFAULT_INPUT_LATENCY;
  }

  updateLatency() {
    if (!this.ctx) return;
    this.keysToLoop.delayTime.value = this.inputLatency;
    this.looper?.port.postMessage({ latency: this.latencySeconds * this.sampleRate });
  }

  /* --------------------------------- keys ---------------------------------- */

  noteOn(id, notes, velocity) {
    this.start();
    return this.synth.noteOn(id, notes, velocity);
  }

  noteOff(id) {
    this.synth?.noteOff(id);
  }

  setSound(name) {
    this.start();
    this.synth.allOff();
    this.synth.sound = name;
  }

  get held() {
    return this.synth?.held ?? [];
  }

  /* --------------------------------- loop ---------------------------------- */

  loopCommand(cmd) {
    this.start();
    // Output latency can settle after start-up; refresh it at every press.
    this.updateLatency();
    this.looper?.port.postMessage({ cmd });
  }

  /* --------------------------------- beat ---------------------------------- */

  get hasLoop() {
    return this.loop.state !== 'empty' && this.loop.state !== 'recording';
  }

  /** Start, switch or stop (null) the beat. */
  setBeat(name) {
    this.start();
    if (!name) {
      this.drums.stop();
      this.beatName = null;
      this.sendGrid();
      return;
    }
    if (!this.drums.playing && this.hasLoop && this.loop.length) {
      // A loop made without a beat: fit the tempo to it and start on its top, so
      // the beat joins in time with what you already made.
      const sr = this.sampleRate;
      const bpm = fitTempo(this.loop.length / sr, this.bpm);
      if (bpm) {
        this.applyTempo(bpm);
        const now = this.ctx.currentTime * sr + 0.05 * sr;
        const top = this.loop.start + Math.ceil((now - this.loop.start) / this.loop.length) * this.loop.length;
        this.drums.play(name, top / sr);
      } else this.drums.play(name);
    } else this.drums.play(name);
    this.beatName = name;
    this.sendGrid();
  }

  /** While a loop is running against the beat, the loop owns the tempo. */
  get tempoLocked() {
    return this.hasLoop && !!this.beatName;
  }

  setTempo(bpm) {
    if (this.tempoLocked) return false;
    this.applyTempo(bpm);
    this.sendGrid();
    return true;
  }

  applyTempo(bpm) {
    this.bpm = Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm)) * 10) / 10;
    this.drums?.setTempo(this.bpm);
    this.fx?.setTempo(this.bpm);
  }

  /** Tell the looper where the bars are, so a take snaps to them. */
  sendGrid() {
    if (!this.looper) return;
    const sr = this.sampleRate;
    if (this.drums.playing) {
      this.looper.port.postMessage({ barSamples: barSeconds(this.bpm) * sr, origin: this.drums.origin * sr });
    } else {
      this.looper.port.postMessage({ barSamples: 0 });
    }
  }

  /* ---------------------------------- mix ---------------------------------- */

  setFx(name, value) {
    this.start();
    this.fx.set(name, value);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /* ------------------------------- recording -------------------------------- */

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Record what you hear (everything after the master) to a file. */
  toggleRecording() {
    this.start();
    if (this.recording) {
      this.recorder.stop();
      return false;
    }
    if (!this.recordTap) {
      this.recordTap = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recordTap);
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    const chunks = [];
    this.recorder = new MediaRecorder(this.recordTap.stream, type ? { mimeType: type, audioBitsPerSecond: 192000 } : {});
    this.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.recorder.onstop = () => this.onRecorded?.(new Blob(chunks, { type: this.recorder.mimeType }));
    this.recorder.start(500);
    return true;
  }

  /* ------------------------------- measuring -------------------------------- */

  receive(blocks) {
    const n = blocks[0].length;
    for (let c = 0; c < 4; c++) {
      const ring = this.rings[c];
      const block = blocks[c];
      const first = Math.min(n, HISTORY - this.write);
      ring.set(block.subarray(0, first), this.write);
      if (first < n) ring.set(block.subarray(first), 0);
    }
    this.write = (this.write + n) % HISTORY;
  }

  snapshot() {
    if (!this.rings) return false;
    const w = this.write;
    const targets = [this.buf1, this.buf2, this.bufL, this.bufR];
    for (let c = 0; c < 4; c++) {
      targets[c].set(this.rings[c].subarray(w), 0);
      targets[c].set(this.rings[c].subarray(0, w), HISTORY - w);
    }
    return true;
  }

  readSpectrum() {
    if (!this.spectrum) return null;
    this.spectrum.getFloatFrequencyData(this.spectrumDb);
    return this.spectrumDb;
  }

  sendLive(targets, f) {
    this.live?.port.postMessage({ targets, f });
  }
}
