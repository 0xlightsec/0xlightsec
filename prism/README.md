# PRISM — synesthesia mapping engine

A desktop instrument that turns what you play into light. Notes are mapped onto the
Circle of Fifths, and the circle *is* the colour wheel: notes that sit next to each
other harmonically get colours that sit next to each other visually. Play a fifth and
the screen resolves to one colour and white. Play a tritone and it splits into
opposites.

**Windows:** open the latest **PRISM Windows build** run under the repository's
**Actions** tab, download the `PRISM-win32-x64` artifact, unzip it anywhere, and
run `PRISM.exe` — no install, no Node. Every build is made on a real Windows
machine, which launches the packaged app and drives it before publishing it. It isn't code-signed, so the first time
Windows SmartScreen will say it "protected your PC": click **More info → Run
anyway**.

**From source** (any platform):

```
cd prism
npm install
npm start
```

**Build the Windows app yourself:** `npm run package:win` (or `package:linux`)
writes `dist/PRISM-win32-x64.zip`. The packaged app runs from a single asar
archive and has Electron's fuses flipped, so it can't be turned into a
general-purpose Node runtime: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
`--inspect` are ignored and only the bundled archive is loaded. ASAR integrity
validation is left off — it needs integrity data in the executable, and a build
that refuses to start couldn't be checked without a Windows machine. The app makes
no network calls: out of the box Electron fetches spellcheck dictionaries from
Google on every launch, and that is switched off.

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
| `1` … `5` | crystal / field / prism / lissajous / orbital |
| `` ` `` | hide the interface |
| `F11` | fullscreen |

**The breakaway key** sits off to the right of the key row, separated by a
perforation. Press it (or `Esc`) and the instrument lets go of the keyboard: notes
stop, the key row greys out, and every key goes back to doing its normal job so you
can type, tab away or use shortcuts. The key itself turns green and becomes **re-arm**
— press `Enter`, click it, or click the stage to take the keyboard back. The
on-screen keys stay playable with the mouse either way.

## Oscilloscope

A second page (switch with **Visualizer / Oscilloscope** in the titlebar): a wave
generator on CH1, your microphone on CH2, a glowing scope screen above and a
readout below.

- **Play** the generator with the same keys as the visualizer (or MIDI) in sine,
  triangle, saw or square. **Latch** holds notes on with a tap, so you can sing
  over a drone with your hands free. Esc is the breakaway, as on the main page.
- **Shapes** (the default) plots each channel against itself a quarter-period
  later — a phase portrait — so a single signal draws a figure: a sine draws a
  circle, a square a square (with its real ringing at the corners), a triangle a
  diamond. Chords draw rolling knots and lattices, your voice draws loops. Shapes
  auto-fit to the screen.
- **Y–T** is the classic dual trace, triggered on a rising edge so it stands
  still (Auto picks the channel with signal), with min-max drawing so a fast wave
  on a slow timebase shows as a band rather than a false squiggle.
- **X–Y** plots the wave across against your voice up: hold a sine and sing a
  fifth above it and you draw the 3 : 2 Lissajous yourself.
- **Music** plays an audio file with its left channel on X and right on Y, on
  green P31-style phosphor. Tracks made for oscilloscopes draw pictures this way.
  Pick a track from the selector — five are built in (Lissajous Intervals,
  Spinning Cube, Rose Garden, PRISM, Star & Shapes), generated by code when chosen
  so they add nothing to the download — or drop a file on the screen or choose
  **Open audio file…**; your files join the list, and when a track ends the next
  one plays. In the built-in tracks the redraw rate of each picture is the pitch
  you hear. Like a real CRT, the beam is
  dim where it moves fast, so the jumps between parts of a picture nearly vanish
  while the slow strokes burn bright.
- **Readout**: the note, frequency, peak-to-peak and RMS level of the wave; the
  pitch, cents, level and clarity of your voice; and, between them, the interval
  your voice makes with the wave, its just ratio, and how many cents you are off
  it, on a tuning meter.
- **Run / Stop** (space) freezes the capture — pixel for pixel, in every view;
  timebase and scale still apply to the frozen frame. **Autoset** fits both channels and the timebase to the signal.

All channels — wave, voice and both sides of the music — are captured by one
AudioWorklet on the audio thread, which sees them in the same 128-sample block, so
they are sample-aligned by construction. (Reading separate AnalyserNodes one after
the other was measured coming back 512 samples apart; for X–Y and oscilloscope
music that scrambles the picture.) The microphone is captured raw — echo cancellation, noise suppression and auto-gain
all reshape the waveform — and never routed to the speakers. Use headphones, or
the mic will hear the generator too.

## Security

The Electron shell is locked down along Electron's security checklist: the
renderer is sandboxed with context isolation and no Node; the microphone (audio
only, never the camera) and MIDI are granted only to the app's own pages; the
window can't navigate outside the app, and only an explicit https link reaches
your browser; `<webview>` is refused; window-control messages are accepted only
from the app's own top-level page; and every response carries a strict
Content-Security-Policy. The rules live in `security.js` and are unit-tested.

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

- **Crystal** — a cluster of long gemstones lit from within, one per note, growing
  from a common seed at its position on the circle. Each stone is built in four
  passes: the light escaping into the air around it, a dense saturated body clipped
  to the silhouette, an elongated inner light down its spine that falls off before
  it reaches the faces (so the shoulders stay dark and the stone reads as lit from
  inside rather than simply bright), then the prism facets and rim. Consonance keeps
  the cluster short, tight and near-parallel in one hue family; dissonance grows the
  stones longer and splays them apart into distinct hues. Filaments between the
  terminations show which intervals are actually sounding.
- **Field** — full-screen colour. Consonant lobes stack and merge into a single
  wash; dissonant ones separate into distinct zones.
- **Prism** — particles fired along each note's angle, scatter widening with tension.

- **Lissajous** — two notes as a glowing 2D Lissajous figure on pure black, drawn at
  their *just* frequency ratio: play C and G and you get "THE PERFECT FIFTH · 3 : 2",
  with the upper note labelling the vertical axis and the lower the horizontal. A few
  slowly decaying, precessing loops nest inside one another, harmonograph-style.
- **Orbital** — a chord as a 3D Lissajous, one axis per voice ("A MAJOR CHORD ·
  4 : 5 : 6"), swept into a spherical shell and slowly drifting inside a glowing cube.
  Near strands burn brighter than far ones.

  Both curve modes take their ratio from whatever you play — a minor triad becomes
  10 : 12 : 15, a dominant seventh 36 : 45 : 54 : 64 — and idle on the canonical
  figure when nothing is held. Each axis follows its own note's envelope, so
  releasing the top note collapses the vertical axis while the bass holds.

  **The spin is the piano's.** On an oscilloscope a two-note figure rolls through
  its phase at the rate the interval misses its just ratio. A real piano misses it
  twice over: equal temperament, then the stretch its stiff strings force on the
  tuning (inharmonicity — overtones run sharp, so tuners widen every octave, the
  Railsback curve). `src/js/theory/piano.js` implements the parametric tuning model
  from Rigaud, David & Daudet, *A Parametric Model of Piano Tuning* (DAFx 2011), and
  the figures spin at the resulting real beat rate: a fifth at middle C rolls at
  0.44 Hz, a major third shimmers at 2.6 Hz, and octaves roll too (0.67 Hz at middle
  C), where textbook equal temperament would freeze them. The synth uses the same
  tuning, so what you hear and what you see agree. Spin is capped at 6 Hz, past which
  the screen's frame rate would alias it into noise.

Palette, wheel rotation, brightness, trail and spin are all live, as are the synth's
waveform, volume, reverb and release. Settings persist between sessions.

## Layout

```
main.js                 Electron main — window, prism:// scheme, guards
security.js             URL, file and permission rules (Electron-free, tested)
scripts/package.mjs     packaged build: asar, fuses, zip
scripts/smoke.mjs       launches a packaged build and drives it (also checks the fuses)
build/                  app icon (PNG for Linux, ICO for Windows)
preload.js              the only bridge into the renderer
src/js/theory/          circle.js · harmony.js · chords.js · ratios.js · piano.js
src/js/io/              midi.js · audio-in.js · keyboard.js · synth.js
src/js/render/          stage.js · harmonic.js (curve modes) · wheel.js
src/js/scope/           engine.js · capture-worklet.js · display.js · measure.js · app.js
src/js/chrome.js        window chrome shared by both pages
src/js/app.js           wiring
tests/theory.test.mjs   npm test
```

`npm test` covers the wheel arithmetic, the tension ordering above, the
consonant-collapses / dissonant-spreads colour behaviour, chord naming, the just
ratios, the piano tuning curve, that each figure spins at its real beat rate, and
the oscilloscope's trigger interpolation, peak-to-peak, RMS and dBFS, and the
main process's URL, path and permission rules.

The piano model's treble asymptote and octave-type curve are the paper's fitted
values; its bass asymptote and transition width are fitted per instrument there, so
the values used here are typical choices, checked against the expected Railsback
range (about −45 cents at A0, +36 at C8).

## Notes

- The renderer is served over a registered `prism://` scheme rather than `file://`,
  which gives it a real secure origin — ES modules, Web MIDI and `getUserMedia` all
  behave as they do on the web.
- Field mode paints its gradients into a quarter-resolution buffer and scales it up;
  for soft gradients that is visually identical and measured 2.4× faster than
  filling at full resolution.
- Polyphonic pitch detection from audio is a much harder problem than monophonic
  tracking and is not attempted here.
