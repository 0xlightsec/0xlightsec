/**
 * Audio for the oscilloscope page.
 *
 *   CH1    wave generator voices -> bus -> limiter -> speakers
 *   CH2    microphone -> trim                        (never to the speakers: feedback)
 *   music  <audio> element -> speakers               (stereo, for oscilloscope music)
 *
 * All three are captured by one AudioWorklet (capture-worklet.js), which sees
 * every channel in the same render quantum, so X-Y and the music display stay
 * sample-aligned. CH1 is captured before the limiter, so the trace shows the true
 * waveform rather than what the limiter does to it.
 *
 * The generator is deliberately bare: one oscillator per note, no detune, filter
 * or reverb, so a saw on the scope is a saw.
 */

import { pianoFrequency } from '../theory/piano.js';

export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];
const HISTORY = 16384;           // samples kept per channel: ~340 ms at 48 kHz
const ATTACK = 0.004;
const RELEASE = 0.06;
const VOICE_PEAK = 0.42;         // one note sits comfortably inside full scale

export class ScopeEngine {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.waveform = 'sawtooth';
    this.volume = 0.4;
    this.micStream = null;
    this.micOn = false;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Created on the first gesture; browsers refuse audio before one. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.bus = ctx.createGain();

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    this.bus.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    this.trim = ctx.createGain();

    // Spectrum of everything on the scope. Alignment doesn't matter for a
    // spectrum, so the built-in FFT is the right tool here.
    this.spectrum = ctx.createAnalyser();
    this.spectrum.fftSize = 8192;
    this.spectrum.smoothingTimeConstant = 0.5;
    this.spectrum.minDecibels = -110;
    this.spectrum.maxDecibels = -10;
    this.bus.connect(this.spectrum);
    this.trim.connect(this.spectrum);
    this.spectrumDb = new Float32Array(this.spectrum.frequencyBinCount);

    // Ring buffers the worklet fills, and the linear copies the display reads.
    this.rings = [0, 1, 2, 3].map(() => new Float32Array(HISTORY));
    this.write = 0;
    this.buf1 = new Float32Array(HISTORY);
    this.buf2 = new Float32Array(HISTORY);
    this.bufL = new Float32Array(HISTORY);
    this.bufR = new Float32Array(HISTORY);

    // Live circles: generated on the audio thread, drawn through the music input.
    // Their own tone is muted unless asked for, so a song or the mic isn't
    // drowned out (or fed back) by a buzz.
    this.liveTone = ctx.createGain();
    this.liveTone.gain.value = 0;
    this.liveTone.connect(this.master);
    this.liveTone.connect(this.spectrum);
    this.liveOn = false;
    this.musicDrawn = true;

    this.ready = Promise.all([
      ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url)),
      ctx.audioWorklet.addModule(new URL('./live-worklet.js', import.meta.url))
    ]).then(() => {
      this.liveNode = new AudioWorkletNode(ctx, 'prism-live', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.liveNode.connect(this.liveTone);
      const node = new AudioWorkletNode(ctx, 'prism-capture', { numberOfInputs: 3, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e) => this.receive(e.data);
      // Its output is silent; connecting it keeps the node pulled by the graph.
      node.connect(ctx.destination);
      this.bus.connect(node, 0, 0);
      this.trim.connect(node, 0, 1);
      this.captureNode = node;
      this.liveNode.connect(node, 0, 2);
      if (this.musicSource && this.musicDrawn) this.musicSource.connect(node, 0, 2);
      if (this.liveOn) this.liveNode.port.postMessage({ active: true });
    });
    return ctx;
  }

  setWaveform(type) {
    if (!WAVEFORMS.includes(type)) return;
    this.waveform = type;
    // Retune held notes in place, so you can watch the shape change under one note.
    for (const v of this.voices.values()) v.osc.type = type;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  noteOn(midi, velocity = 0.8) {
    const ctx = this.ensure();
    this.noteOff(midi, true);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = pianoFrequency(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(VOICE_PEAK * velocity, now + ATTACK);
    osc.connect(gain).connect(this.bus);
    osc.start(now);
    this.voices.set(midi, { osc, gain, velocity });
  }

  noteOff(midi, immediate = false) {
    const v = this.voices.get(midi);
    if (!v) return;
    this.voices.delete(midi);
    const now = this.ctx.currentTime;
    const tail = immediate ? 0.005 : RELEASE;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + tail);
    v.osc.stop(now + tail + 0.02);
  }

  allOff() {
    for (const m of [...this.voices.keys()]) this.noteOff(m);
  }

  get held() {
    return [...this.voices.keys()].sort((a, b) => a - b);
  }

  async startMic() {
    this.ensure();
    if (this.micOn) return true;
    try {
      // Raw signal: echo cancellation, noise suppression and auto-gain all reshape
      // the waveform, which is the thing we are trying to look at.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      // Tell "no microphone" apart from "not allowed": they need different fixes.
      this.micError = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'missing' : 'blocked';
      return false;
    }
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.trim);
    this.micOn = true;
    this.micError = null;
    return true;
  }

  stopMic() {
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micStream = null;
    this.micOn = false;
  }

  /** A block of aligned samples from the worklet: [ch1, ch2, left, right]. */
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

  /** Copy the rings, oldest sample first, into the buffers the display reads. */
  snapshot() {
    if (!this.ctx) return false;
    const w = this.write;
    const targets = [this.buf1, this.buf2, this.bufL, this.bufR];
    for (let c = 0; c < 4; c++) {
      const ring = this.rings[c];
      targets[c].set(ring.subarray(w), 0);
      targets[c].set(ring.subarray(0, w), HISTORY - w);
    }
    return true;
  }

  /* ------------------------------ live circles ----------------------------- */

  /**
   * Turn the live circles on or off. While on, a playing song is heard and
   * analysed but not drawn: it steers the circles instead of competing with them.
   */
  setLive(on) {
    this.ensure();
    this.liveOn = on;
    this.liveNode?.port.postMessage({ active: on });
    const draw = !on;
    if (this.musicSource && this.captureNode && draw !== this.musicDrawn) {
      if (draw) this.musicSource.connect(this.captureNode, 0, 2);
      else this.musicSource.disconnect(this.captureNode, 0, 2);
    }
    this.musicDrawn = draw;
  }

  setLiveTone(on) {
    if (this.liveTone) this.liveTone.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.03);
  }

  /** Shape targets for [music circle, voice circle], and the drawing rate in Hz. */
  sendLive(targets, f) {
    this.liveNode?.port.postMessage({ targets, f });
  }

  /** The latest 2048 samples of the song alone, or null if nothing is loaded. */
  readSong() {
    if (!this.songTap) return null;
    this.songTap.getFloatTimeDomainData(this.songBuf);
    return this.songBuf;
  }

  /** Current spectrum in dB per bin, or null before audio has started. */
  readSpectrum() {
    if (!this.spectrum) return null;
    this.spectrum.getFloatFrequencyData(this.spectrumDb);
    return this.spectrumDb;
  }

  /* ------------------------------ music player ----------------------------- */

  /** Play an audio file; its left channel drives X and its right drives Y. */
  async loadMusic(file) {
    const ctx = this.ensure();
    if (!this.player) {
      this.player = new Audio();
      this.player.preload = 'auto';
      this.player.addEventListener('ended', () => this.onMusicEnded?.());
      this.musicSource = ctx.createMediaElementSource(this.player);
      // Straight to the volume control: music is mastered already and must not
      // be squashed by the generator's limiter.
      this.musicSource.connect(this.master);
      this.musicSource.connect(this.spectrum);
      // A tap on the song alone, for the live circles to follow.
      this.songTap = ctx.createAnalyser();
      this.songTap.fftSize = 2048;
      this.songBuf = new Float32Array(2048);
      this.musicSource.connect(this.songTap);
      if (this.captureNode && this.musicDrawn) this.musicSource.connect(this.captureNode, 0, 2);
    }
    if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
    this.musicUrl = URL.createObjectURL(file);
    this.musicName = file.name;
    this.player.src = this.musicUrl;
    await this.ready;
    try {
      await this.player.play();
      return true;
    } catch (err) {
      this.musicError = err?.message ?? 'could not play this file';
      return false;
    }
  }

  get musicPlaying() {
    return !!this.player && !this.player.paused && !this.player.ended;
  }

  toggleMusic() {
    if (!this.player?.src) return;
    if (this.player.paused) this.player.play();
    else this.player.pause();
  }

  seekMusic(fraction) {
    if (this.player?.duration) this.player.currentTime = fraction * this.player.duration;
  }
}
