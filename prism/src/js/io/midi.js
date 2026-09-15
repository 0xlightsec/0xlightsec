/** Web MIDI input: note on/off, velocity, sustain pedal (CC64). */

export class MidiInput {
  constructor(handlers = {}) {
    this.access = null;
    this.inputs = [];
    this.selectedId = 'all';
    this.handlers = handlers;
    this.sustain = false;
    this.held = new Set();
    this.status = 'idle';
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      this.handlers.onStatus?.(this.status, []);
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.status = 'denied';
      this.handlers.onStatus?.(this.status, [], err?.message);
      return false;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
    return true;
  }

  refresh() {
    if (!this.access) return;
    this.inputs = [...this.access.inputs.values()];
    for (const input of this.inputs) input.onmidimessage = (e) => this.onMessage(input, e);
    this.status = this.inputs.length ? 'connected' : 'no-devices';
    this.handlers.onStatus?.(this.status, this.inputs.map((i) => ({ id: i.id, name: i.name, manufacturer: i.manufacturer })));
  }

  select(id) {
    this.selectedId = id;
    this.panic();
  }

  onMessage(input, event) {
    if (this.selectedId !== 'all' && input.id !== this.selectedId) return;
    const [status, d1, d2] = event.data;
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (type === 0x90 && d2 > 0) {
      this.held.add(d1);
      this.handlers.onNoteOn?.(d1, d2 / 127, { channel, device: input.name });
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      this.held.delete(d1);
      if (!this.sustain) this.handlers.onNoteOff?.(d1, { channel });
      else this.handlers.onSustained?.(d1);
    } else if (type === 0xb0 && d1 === 64) {
      const down = d2 >= 64;
      this.sustain = down;
      this.handlers.onSustain?.(down);
    } else if (type === 0xb0 && (d1 === 120 || d1 === 123)) {
      this.panic();
    } else if (type === 0xe0) {
      const bend = ((d2 << 7) | d1) / 8192 - 1;
      this.handlers.onPitchBend?.(bend);
    }
  }

  panic() {
    for (const note of [...this.held]) this.handlers.onNoteOff?.(note, {});
    this.held.clear();
    this.sustain = false;
    this.handlers.onSustain?.(false);
  }
}
