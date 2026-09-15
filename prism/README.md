# PRISM — synesthesia mapping engine

A desktop instrument that turns what you play into light. Notes are mapped onto the
Circle of Fifths, and the circle *is* the colour wheel: notes that sit next to each
other harmonically get colours that sit next to each other visually. Play a fifth and
the screen resolves to one colour and white. Play a tritone and it splits into
opposites.

```
cd prism
npm install
npm start
```

Electron app, no build step.

## How the mapping works

**The wheel.** Position *k* on the Circle of Fifths holds pitch class `(7k mod 12)` —
C G D A E B F♯ C♯ G♯ D♯ A♯ F. Each position owns a 30° slice of hue, so one step
around the circle is one step around the colour wheel. (Because 7 is its own inverse
mod 12, the reverse lookup is just `(pc * 7) mod 12`.)

**Tension.** Every sounding chord gets one number in `0..1`, measured purely in
fifths — half from the average pairwise distance between its notes, half from the
total width of the arc containing them:

| played | tension | reads as |
|---|---|---|
| single note | 0.00 | one colour |
| perfect fifth | 0.15 | colour + white |
| stack of fifths (C G D) | 0.25 | one hue, shaded |
| major triad | 0.51 | related hues |
| dominant 7th | 0.69 | separating |
| tritone | 0.93 | opposites |
| chromatic cluster | 0.83 | full spread |

**Colour.** Tension controls how far each note's hue is allowed to travel from the
chord's hue centroid. Near zero the hues collapse onto each other and alternate
voices bleach toward white; near one they sit at their true positions, fully
saturated and distinct. That single lever produces both of the behaviours the
visualiser needs — cohesion for consonance, spread for dissonance — from the same
code path.

## Playing it

The computer keyboard is a keyboard. While the window is focused it is **captured**:
note keys play notes instead of doing whatever they'd normally do.

| key | |
|---|---|
| `A S D F G H J K L ; '` | white keys |
| `W E T Y U O P` | accidentals |
| `Z` `X` | octave down / up |
| `,` `.` | velocity |
| **`Esc`** | **breakaway — release the keyboard** |
| `Enter` | re-arm the keyboard |
| `1` `2` `3` | crystal / field / prism |
| `` ` `` | hide the interface |
| `F11` | fullscreen |

**The breakaway key** sits off to the right of the key row, separated by a
perforation. Press it (or `Esc`) and the instrument lets go of the keyboard: notes
stop, the key row greys out, and every key goes back to doing its normal job so you
can type, tab away or use shortcuts. The key itself turns green and becomes **re-arm**
— press `Enter`, click it, or click the stage to take the keyboard back. The
on-screen keys stay playable with the mouse either way.

## Input

- **MIDI** — any Web MIDI device. Note on/off with velocity, sustain pedal (CC 64),
  pitch bend, all-notes-off. Full polyphony. Pick a device or listen to all of them.
- **Microphone** — normalised-square-difference pitch tracking (an McLeod/YIN-style
  autocorrelation) with parabolic peak interpolation, tracking synthetic tones from
  E2 to C6 to within a cent. It is **monophonic** by design: it follows one line, so
  chords should come from MIDI or the computer keyboard.
- **Computer keyboard** — polyphonic, with a built-in two-oscillator synth so the
  keys make sound as well as light.

## Output modes

- **Crystal** — a faceted structure; one shard per note at its position on the
  circle. Consonance pulls the shards into a tight gem, dissonance throws them
  outward. Lines between tips show which intervals are actually sounding.
- **Field** — full-screen colour. Consonant lobes stack and merge into a single
  wash; dissonant ones separate into distinct zones.
- **Prism** — particles fired along each note's angle, scatter widening with tension.

Palette, wheel rotation, brightness, trail and spin are all live, as are the synth's
waveform, volume, reverb and release. Settings persist between sessions.

## Layout

```
main.js                 Electron main — window, custom prism:// scheme, permissions
preload.js              the only bridge into the renderer
src/js/theory/          circle.js · harmony.js · chords.js   (no DOM, unit-tested)
src/js/io/              midi.js · audio-in.js · keyboard.js · synth.js
src/js/render/          stage.js (three modes) · wheel.js
src/js/app.js           wiring
tests/theory.test.mjs   npm test
```

`npm test` covers the wheel arithmetic, the tension ordering above, the
consonant-collapses / dissonant-spreads colour behaviour, and chord naming.

## Notes

- The renderer is served over a registered `prism://` scheme rather than `file://`,
  which gives it a real secure origin — ES modules, Web MIDI and `getUserMedia` all
  behave as they do on the web.
- Field mode paints its gradients into a quarter-resolution buffer and scales it up;
  for soft gradients that is visually identical and measured 2.4× faster than
  filling at full resolution.
- Polyphonic pitch detection from audio is a much harder problem than monophonic
  tracking and is not attempted here.
