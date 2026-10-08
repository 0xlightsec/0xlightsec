/**
 * The beatmaker's audio: transport, sequencer, live playing and recording, and
 * offline export.
 *
 *   channels ─▶ instruments ─▶ mixer inserts ─▶ master ─▶ pads ─▶ limiter ─▶ volume ─▶ speakers
 *
 * The pads are the performance effects held on the whole mix (stutter, tape
 * stop), from the Live page, locked to the song's grid.
 *
 * The sequencer is the "two clocks" kind: a timer every 25 ms books the notes of
 * the next 120 ms on the audio clock, so timing never depends on the page.
 * Pattern mode loops the current pattern; song mode plays the playlist.
 *
 * Export renders the song (or the pattern) through the very same instruments and
 * mixer on an OfflineAudioContext, faster than real time, so the file sounds
 * exactly like playback.
 */

import { Mixer } from './mixer.js';
import { Instrument } from './instruments.js';
import { eventsBetween, swingOffset } from './model.js';
import { stepSeconds } from '../studio/drums.js';

const LOOKAHEAD = 0.12;
const TICK_MS = 25;
const START_DELAY = 0.06;
const RENDER_CHUNK = 2;    // export: seconds booked per pause
const RENDER_AHEAD = 0.5;  // and how far past the next pause
const AUTO_DT = 0.04;      // export: how often automation is applied

/** Does any mixer strip have an automation curve? */
const hasAutomation = (song) => song.data.mixer.some((t) => t.auto && Object.keys(t.auto).length);

function limiter(ctx) {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = -3;
  l.knee.value = 3;
  l.ratio.value = 20;
  l.attack.value = 0.002;
  l.release.value = 0.12;
  return l;
}

/**
 * The playable graph for a song on any audio context: one instrument per channel
 * and the mixer. `taps` are extra outputs for measuring { synth, drum }.
 */
export class Rig {
  constructor(ctx, out, taps = {}) {
    this.ctx = ctx;
    this.mixer = new Mixer(ctx, out);
    this.instruments = new Map();
    this.taps = taps;
    this.bpm = 0;
    this.automating = false;
  }

  sync(song) {
    const seen = new Set();
    this.mixer.resize(song.data.mixer.length - 1); // before routing: a channel may play through a new insert
    for (const ch of song.channels) {
      seen.add(ch.id);
      const out = this.mixer.input(ch.insert);
      let inst = this.instruments.get(ch.id);
      if (!inst) {
        inst = new Instrument(this.ctx, out, ch, ch.kind === 'drum' ? this.taps.drum : this.taps.synth);
        inst.setTempo(song.data.bpm); // tempo-synced wobbles, tremolo and risers need it from the start
        this.instruments.set(ch.id, inst);
      } else inst.route(out);
      inst.update(ch, song.audible(ch));
    }
    for (const [id, inst] of this.instruments) {
      if (!seen.has(id)) {
        inst.dispose();
        this.instruments.delete(id);
      }
    }
    this.mixer.update(song.data.mixer, this.automating);
    if (song.data.bpm !== this.bpm) {
      this.bpm = song.data.bpm;
      this.mixer.setTempo(this.bpm);
      for (const inst of this.instruments.values()) inst.setTempo(this.bpm);
    }
  }

  /** Book every note in [s0, s1) of the transport; step 0 is at `origin` seconds. */
  book(song, mode, s0, s1, origin) {
    const step = stepSeconds(song.data.bpm);
    const swing = song.data.swing;
    for (const ev of eventsBetween(song, mode, s0, s1)) {
      const inst = this.instruments.get(ev.channel);
      if (!inst?.audible) continue; // a muted channel's notes would only cost time
      const at = origin + (ev.step + swingOffset(ev.step, swing)) * step;
      const length = Math.min(ev.note.length, ev.room);
      inst.schedule(ev.note, at, Math.max(0.03, length * step * 0.97));
    }
    // Gates chop each sixteenth, swung like the notes.
    if (this.mixer.strips.some((st) => st.fx.values.gate >= 0.001)) {
      const time = (k) => origin + (k + swingOffset(k, swing)) * step;
      for (let k = Math.ceil(s0 - 1e-9); k < s1; k++) this.mixer.gateStep(time(k), time(k + 1) - time(k));
    }
  }

  /**
   * Automation: in song mode, automated effects follow their curves. Turning it
   * off puts every effect back on its knob.
   */
  automate(song, step) {
    if (!this.automating) {
      this.automating = true;
      this.mixer.update(song.data.mixer, true);
    }
    this.mixer.automate(song.data.mixer, step);
  }

  stopAutomating(song) {
    if (!this.automating) return;
    this.automating = false;
    this.mixer.update(song.data.mixer, false);
  }

  cancel() {
    for (const inst of this.instruments.values()) inst.cancel();
    this.mixer.gateOpen();
  }
}

export class DawEngine {
  constructor(song) {
    this.song = song;
    this.ctx = null;
    this.playing = false;
    this.metronome = false;
    this.recording = false;
    this.volume = 0.8;
    this.live = new Map();     // id -> { channel, midis, velocity, step } for live notes
    this.onRecorded = null;    // ({ channel, notes }) when a recorded note ends
    this.origin = 0;
    this.booked = 0;
    this.timer = 0;
    this.bpm = song.data.bpm;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.limiter = limiter(ctx);
    this.limiter.connect(this.master).connect(ctx.destination);
    // Everything the rig plays meets here, then the pads once they've loaded.
    this.bus = ctx.createGain();
    this.bus.connect(this.limiter);
    this.ready = ctx.audioWorklet.addModule(new URL('../studio/perf-worklet.js', import.meta.url)).then(() => {
      this.pads = new AudioWorkletNode(ctx, 'prism-perf', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.bus.disconnect(this.limiter);
      this.bus.connect(this.pads).connect(this.limiter);
      this.sendPadGrid();
    }).catch(() => { /* no pads; everything else plays */ });
    // Taps for the visualizer: melody and drums, measured apart; the whole mix after the limiter.
    const tap = (size) => {
      const a = ctx.createAnalyser();
      a.fftSize = size;
      return a;
    };
    this.synthTap = tap(2048);
    this.drumTap = tap(1024);
    this.outTap = tap(2048);
    this.limiter.connect(this.outTap);
    this.rig = new Rig(ctx, this.bus, { synth: this.synthTap, drum: this.drumTap });
    this.rig.sync(this.song);
    this.click = ctx.createGain();
    this.click.gain.value = 0.35;
    this.click.connect(this.master);
    return ctx;
  }

  /** The song changed: bring the instruments and mixer in line. */
  sync(song = this.song) {
    this.song = song;
    if (!this.ctx) return;
    if (song.data.bpm !== this.bpm && this.playing) {
      // Keep the playhead where it is through a tempo change.
      const now = this.ctx.currentTime;
      const at = (now - this.origin) / stepSeconds(this.bpm);
      this.origin = now - at * stepSeconds(song.data.bpm);
    }
    const moved = song.data.bpm !== this.bpm;
    this.bpm = song.data.bpm;
    this.rig.sync(song);
    if (moved) this.sendPadGrid();
  }

  /* ---------------------------------- pads ----------------------------------- */

  /** Hold a pad: { stutter: 2 | 1 | 0 } (eighths, sixteenths, let go) or { tape: true | false }. */
  pad(msg) {
    this.start();
    this.pads?.port.postMessage(msg);
  }

  /** Stutter slices land on the song's sixteenths. */
  sendPadGrid() {
    if (!this.pads) return;
    const sr = this.sampleRate;
    this.pads.port.postMessage({ grid: { step: stepSeconds(this.bpm) * sr, origin: this.origin * sr } });
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get mode() {
    return this.song.data.mode;
  }

  /* -------------------------------- transport -------------------------------- */

  /** Play from a step (song mode: the song position; pattern mode: the top). */
  play(from = this.mode === 'song' ? this.song.data.position : 0) {
    this.start();
    if (this.playing) this.stop();
    const step = stepSeconds(this.bpm);
    const start = Math.max(0, Math.min(from, this.song.period() - 1e-6));
    this.origin = this.ctx.currentTime + START_DELAY - start * step;
    this.booked = this.ctx.currentTime + START_DELAY;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.sendPadGrid();
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.rig.cancel();
    this.rig.stopAutomating(this.song);
    this.finishRecording();
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play();
  }

  /** Where the playhead is, in steps within the pattern or song (null when stopped). */
  position(t = this.ctx?.currentTime ?? 0) {
    if (!this.playing) return null;
    const s = (t - this.origin) / stepSeconds(this.bpm);
    if (s < 0) return null;
    const period = this.song.period();
    return ((s % period) + period) % period;
  }

  tick() {
    if (!this.playing) return;
    const until = this.ctx.currentTime + LOOKAHEAD;
    const step = stepSeconds(this.bpm);
    const s0 = (this.booked - this.origin) / step;
    const s1 = (until - this.origin) / step;
    if (s1 > s0) {
      this.rig.book(this.song, this.mode, s0, s1, this.origin);
      if (this.metronome) this.bookClicks(s0, s1);
    }
    this.booked = Math.max(this.booked, until);
    // Automation follows what you're hearing now, in song mode.
    if (this.mode === 'song' && hasAutomation(this.song)) this.rig.automate(this.song, this.position() ?? 0);
    else this.rig.stopAutomating(this.song);
  }

  bookClicks(s0, s1) {
    for (let beat = Math.ceil(s0 / 4 - 1e-9); beat * 4 < s1; beat++) {
      const at = this.origin + beat * 4 * stepSeconds(this.bpm);
      const bar = beat % 4 === 0;
      const o = this.ctx.createOscillator();
      o.frequency.value = bar ? 1760 : 1320;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(bar ? 1 : 0.6, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      o.connect(g).connect(this.click);
      o.start(at);
      o.stop(at + 0.06);
    }
  }

  /* ----------------------------- live and record ----------------------------- */

  /** The transport step a sound played now was meant for: what you heard a moment ago. */
  heardStep() {
    const latency = (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0);
    return (this.ctx.currentTime - latency - this.origin) / stepSeconds(this.bpm);
  }

  liveOn(id, channelId, midis, velocity = 0.8) {
    this.start();
    const inst = this.rig.instruments.get(channelId);
    if (!inst) return;
    this.liveOff(id);
    inst.noteOn(id, midis, velocity);
    this.live.set(id, { channel: channelId, midis, velocity, step: this.recording && this.playing ? this.heardStep() : null });
  }

  liveOff(id) {
    const held = this.live.get(id);
    if (!held) return;
    this.live.delete(id);
    this.rig.instruments.get(held.channel)?.noteOff(id);
    if (held.step !== null && this.playing) this.record(held, this.heardStep());
  }

  /** Hear a note on a channel without recording it: held (on = true / false) or a short blip. */
  preview(channelId, midi, on) {
    this.start();
    const inst = this.rig.instruments.get(channelId);
    if (!inst || !Number.isFinite(midi)) return;
    const id = `preview:${channelId}:${midi}`;
    if (on === false) inst.noteOff(id);
    else {
      inst.noteOn(id, [midi], 0.75);
      if (on !== true) setTimeout(() => inst.noteOff(id), 220);
    }
  }

  /** Hear a sound or drum that isn't a channel yet (the browser), through the master. */
  audition(spec, midi = 60) {
    this.start();
    const ch = { kind: spec.kind, sound: spec.sound, drum: spec.drum, kit: spec.kit ?? 'classic', shape: { tone: 0.5, attack: 0.5, release: 0.5 }, volume: 0.8, pan: 0 };
    if (!this.auditioner) this.auditioner = new Instrument(this.ctx, this.rig.mixer.input(0), ch);
    else this.auditioner.update(ch, true);
    this.auditioner.setTempo(this.bpm);
    this.auditioner.noteOn('audition', ch.kind === 'drum' ? [60] : [midi], 0.8);
    clearTimeout(this.auditionTimer);
    this.auditionTimer = setTimeout(() => this.auditioner.noteOff('audition'), 450);
  }

  /** A recorded note, folded into the pattern (or song) loop it was played over. */
  record(held, end) {
    const period = this.song.period();
    const start = ((held.step % period) + period) % period;
    const length = Math.max(0.25, end - held.step);
    this.onRecorded?.({ channel: held.channel, notes: held.midis.map((midi) => ({ start, length, midi, velocity: held.velocity })) });
  }

  finishRecording() {
    for (const [id, held] of this.live) {
      if (held.step === null) continue;
      held.step = null;
      this.live.set(id, held);
    }
  }

  /** Notes sounding now, for the visualizer: { melody: [...midi], drums: bool }. */
  sounding() {
    if (!this.ctx) return { melody: [], drums: false };
    const t = this.ctx.currentTime;
    const melody = [];
    let drums = false;
    for (const inst of this.rig.instruments.values()) {
      const s = inst.sounding(t);
      if (inst.drums) drums ||= s.length > 0;
      else melody.push(...s);
    }
    return { melody: melody.sort((a, b) => a - b), drums };
  }

  /* --------------------------------- export ---------------------------------- */

  /**
   * Render the song or the current pattern to an AudioBuffer, offline. One pass
   * through, plus a tail for reverb and echoes to ring out.
   */
  async render(mode = this.mode, { tail = 2, sampleRate = this.sampleRate } = {}) {
    const song = this.song;
    const period = song.period(mode);
    const step = stepSeconds(song.data.bpm);
    const seconds = period * step + tail;
    const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const lim = limiter(off);
    lim.connect(off.destination);
    const rig = new Rig(off, lim);
    rig.sync(song);
    // Book a few seconds at a time, as playback does, pausing the render to book
    // the next stretch. Booking the whole song up front would put every voice of
    // it in the graph from the first sample, and a long song would crawl.
    const origin = 0.02;
    let booked = 0;
    const bookUntil = (t) => {
      const s1 = Math.min(period, (t - origin) / step);
      if (s1 > booked) {
        rig.book(song, mode, booked, s1, origin);
        booked = s1;
      }
    };
    // Automation is applied as the render goes, every AUTO_DT, as playback does every tick.
    const automated = mode === 'song' && hasAutomation(song);
    const at = (t) => Math.max(0, (t - origin) / step);
    if (automated) rig.automate(song, 0);
    bookUntil(RENDER_CHUNK + RENDER_AHEAD);
    const every = automated ? AUTO_DT : RENDER_CHUNK;
    for (let k = 1; k * every < seconds; k++) {
      const t = k * every;
      off.suspend(t).then(() => {
        bookUntil(t + RENDER_CHUNK + RENDER_AHEAD);
        if (automated) rig.automate(song, Math.min(at(t), period));
        off.resume();
      });
    }
    return off.startRendering();
  }
}
