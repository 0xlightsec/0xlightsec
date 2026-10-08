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

## Studio

PRISM opens on the **Studio**, a beatmaker laid out like FL Studio. The window
shortcuts are FL's too.

| window | key | what it's for |
|---|---|---|
| **Browser** | `F8` | sounds, drums, kits and ready-made beats: click to hear, **+** to add |
| **Playlist** | `F5` | the song: pattern clips on tracks along a timeline of bars |
| **Channel Rack** | `F6` | every instrument, with a row of steps for the current pattern |
| **Piano Roll** | `F7` | the selected channel's notes, drawn on a grid |
| **Mixer** | `F9` | the master and 8 inserts: fader, pan, mute/solo, meter, effects |

**Transport.** **PAT** loops the current pattern; **SONG** plays the Playlist
(`Ctrl+L` switches). `Space` plays and stops. `R` arms recording. `M` turns on the
metronome. Drag the tempo up or down, scroll it, or double-click to type one. `F4`
makes a new pattern, and `[` / `]` step through them. `Ctrl+Z` / `Ctrl+Y` undo and
redo anything, one gesture at a time.

**Channel Rack.** A new song starts with Kick, Clap, Hat, Snare, an 808 and a
Pluck, each on its own mixer insert, named after it. Click steps to toggle them, or
drag across to paint. Each row also has:
- a mute LED (right-click it to solo);
- pan and volume knobs;
- its mixer insert;
- the channel button: click to select (the keyboard and MIDI play the selected
  channel), double-click to open the piano roll.

A channel with pitched or long notes shows them in miniature instead of steps. The
panel on the right edits the selected channel: its sound (any of the 27), or its
drum (Kick, Snare, Clap, Hat, Open Hat, Crash, Tom, Rim) and kit (Classic, Boom,
Lo-fi, Hyper, Rage, Club, Rock). It also has Tone/Attack/Release, the mixer insert,
quick fills (every ⅛, ¼, ½ or bar), move, clone and delete. Patterns are 1–16 bars
long and have a swing knob. **Beats** in the Browser writes a ready-made groove
(Pulse to Grunge) into the current pattern. In an empty song it brings its tempo too.

**Piano Roll.**
- **Draw:** click to draw at the last note's length; with **Chords** on, a click
  draws the whole chord that fits the key.
- **Edit:** drag to move, drag a note's end to resize, right-click (or right-drag)
  to delete.
- **Select:** `Ctrl`+drag box-selects and `Shift`+click adds to the selection.
  `Ctrl+A`, `Ctrl+C`, `Ctrl+X` and `Ctrl+V` work as usual; `Ctrl+B` duplicates
  onto the next beat or bar; `Delete` removes the selection.
- **Move by keys:** `↑`/`↓` transpose (`Shift` for an octave) and `←`/`→` nudge by
  the snap.
- **Velocity:** the lane underneath sets it, for a chord or the whole selection.
- **Help:** other channels show as faint ghost notes; rows in the chosen key are
  lit. Snap from 1/4 to 1/32; `Ctrl`+wheel zooms and `Shift`+wheel scrolls.

**Playlist.** Click to place the current pattern, drag to move it (`Alt` for beats
instead of bars), drag a clip's end to stretch it, and the pattern repeats.
Right-click deletes. Click a clip to make its pattern current; double-click opens
it. Click the ruler to set where the song plays from. Switching to SONG with an
empty playlist puts the current pattern in at bar 1.

**Mixer.** Every channel plays into its insert and every insert into the master.
Each strip has a fader, pan, mute/solo and a peak meter, and lists the channels
feeding it. Click a strip to edit its effects: Drive, Crush, Filter, Echo (synced
to the tempo), Space (one shared hall) and Tape. Double-click a name to rename it.

**MIDI.**
- A MIDI keyboard plays the selected channel.
- Drum pads on MIDI channel 10 play the matching drum channels by General MIDI note
  (36 kick, 38 snare, 39 clap, 42 hat, 46 open hat …).
- With record armed, whatever you play, from the computer keyboard or MIDI, lands
  in the pattern where you heard it. Output latency is taken off, and with **Rec
  snap** on the notes snap to the grid. A whole take is one undo step.
- **Export → Song/Pattern as MIDI** writes a standard `.mid`: drums on channel 10
  with GM notes, a track per channel, and the tempo, ready for FL Studio, Ableton or
  hardware. **Import** reads `.mid` files (type 0 or 1) into a new pattern. Drum
  tracks go onto your drum channels and every other track becomes a synth channel.

**Export → Song/Pattern as WAV** renders offline, faster than real time, through
the same instruments and mixer, so the file sounds exactly like playback.

**Songs** (`Ctrl+S`) keeps your songs inside the app. Open, save as a
`.prismbeat` file, delete, or start a new one. The song you're working on is also
kept between sessions automatically.

**The keyboard** at the bottom plays the selected channel, as before: `A`…`'` and
`W E T Y U O P`, `Z`/`X` for the octave, `C` for chords, and **Breakaway** (`Esc`)
hands the keyboard back. The Browser's corner shows the beat as light: one circle
follows the melody (its notes set the petals), the other the drums.

## Live

The **Live** page is the looper and live circles, all still there: sing to move
the shape, and loop, layer and effect your voice and keys with no setup. The mic
switches on by itself.

- **Sing** and the upper-right circle follows your voice. Louder spins it faster
  and blooms it from a circle into a flower, the note sets the number of petals
  (one more per step around the Circle of Fifths), and a rising melody spins it one
  way while a falling one spins it the other. The lower-left circle does the same
  for the music: keys, loop and beat.
- **Loop**: one button, like a loop pedal. Press `Space` to record, press again
  and it loops, press again to add a layer, press again to keep it. Up to eight
  layers. **Undo** (`Backspace` or `Ctrl+Z`) takes back the last layer and **Redo**
  (`Shift+Backspace`, `Ctrl+Shift+Z` or `Ctrl+Y`) puts it back, until you record
  something new. `Delete` clears everything.
- **Beat**: nine grooves, each with its own drum kit and tempo (`B` turns it on and
  off): Pulse, Groove, Trap, **Lo-fi** (swung and dusty, with vinyl crackle),
  **Hyper** (hyperpop: blown-out kick, claps, hat rolls), **Rage** (distorted 808s),
  **Jersey** (club kicks), **Punk** and **Grunge** (live-kit snare and crash). With
  a beat running a take snaps to 1, 2, 4 or 8 whole bars and starts on the nearest
  downbeat, so loops always line up however sloppily you press. If you make a loop
  first and add the beat afterwards, the tempo snaps to fit the loop instead.
- **Sound**: 27 sounds in six groups (`1` to `6` picks a group; press it again
  for the next sound in it):
  - **Keys**: Soft Keys, E-Piano, Organ, Bells, Lo-fi Keys, Marimba
  - **Pads**: Warm Pad, Strings, Choir, Glass
  - **Bass**: Sub Bass, 808, Wobble (synced to the beat), Reese
  - **Lead**: Square Lead, Supersaw, Chiptune, Grunge Guitar (a distorted power
    chord from one key), Whistle
  - **Pluck**: Pluck, Harp, Kalimba, Stab
  - **Hyper**: Rage Lead, Hyper Lead, Glitch Bell, Dist 808

  **Tone**, **Attack** and **Release** reshape whichever one you pick; the centre
  is the sound as designed. Basses and some leads play one note at a time and
  glide between notes.
- **Keys** (left of the keyboard): **Chords** (`C`) makes every key play a whole
  chord that belongs to the key you're in, so nothing you press can sound wrong.
  **Key** moves the whole keyboard; `Z` and `X` change octave.
- **Effects**: Drive (soft-clip distortion), Crush (bit crusher), Filter (a DJ
  filter: left of centre is darker, right is thinner, centre does nothing), Echo
  (dotted eighths, synced to the tempo), Space (reverb), Tape (wow, flutter and a
  worn top end: the lo-fi wobble) and Level. Drag, scroll or use the arrow keys;
  double-click resets a knob.
- **Voice**: **Pitch** shifts your voice up to an octave up (chipmunk) or down
  (demon) without changing its speed; **Tune** snaps it to the key you're in, and
  all the way up it jumps note to note, the hard-tuned hyperpop sound. Both change
  what's recorded into the loop.
- **Pads** (bottom right of the screen, hold them): **Stutter ⅛** (`Q`) and
  **Stutter 1/16** (`R`) repeat the last slice in time, the beat-repeat move;
  **Tape stop** (`V`) winds everything down like a turntable losing power. Let go
  and the music is right where it would have been.
- **Effects per layer**: every loop layer keeps its own effects. A new layer
  starts with the **Live** effects as they were while you recorded it, so it keeps
  sounding the way you played it when you change the knobs afterwards. Click a
  layer's number (in the Loop panel or above the knobs) and the knobs turn just
  that layer: crush the drums you beatboxed, filter one layer away, or **Mute** it.
  Undo and Redo keep each layer's settings.
- **Piano roll** (titlebar, or `N`): draw notes on a grid like FL Studio. Click to
  draw (the length of the last note), drag to move, drag a note's end to resize,
  right-click (or right-drag) to delete, and drag the velocity lane under a note to
  make it softer or harder. Rows in your key are lit, chord mode draws whole
  chords, and notes are coloured by the Circle of Fifths. Patterns are 1, 2, 4 or
  8 bars, snapping to 1/4 to 1/32 notes, with Quantize, Undo and Redo (`Ctrl+Z` /
  `Ctrl+Y` while it's open) and Clear. **Play** runs it in time with the beat (or
  the loop) through its own sound and its own effects (**Roll** above the knobs).
  It isn't recorded into loops unless you turn on **Into loop**. The pattern is
  kept between sessions and saved with your loops.
- **Loops** in the titlebar: name your loop and save it (or press `Ctrl+S`); load
  any saved loop with one click. A save keeps every layer and its effects, the beat
  and tempo, your sound, key and voice settings. **File** saves one as a `.prism`
  file to keep or share, and **Open a .prism file** loads one (and adds it to your
  loops).
- **Record song** in the titlebar saves everything you hear to a file.

**Headphones.** The Live page never plays your mic through the speakers, because it
would howl. Turn on **Headphones** to hear yourself through the effects. With it
off, the mic's echo cancellation is on, so the speakers aren't recorded into your
loop either.

**Timing.** Everything is placed on the audio clock. What the mic hears was sung
against what played a moment earlier (the output latency to your ears plus the
input latency back), so takes and overdubs are written that far back and layers
never drift. Keys are delayed into the looper by the input latency, so a note you
play lands in the same place as a note you sing. A short pre-roll is always kept,
so pressing record just after the downbeat loses nothing, and the loop keeps
filling after the last press until its final moment has arrived.

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

Another page (switch with **Studio / Live / Visualizer / Oscilloscope** in the titlebar): a wave
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
  Pick a track from the selector — six are built in (Two Circles, Lissajous
  Intervals, Spinning Cube, Rose Garden, PRISM, Star & Shapes), generated by code when chosen
  so they add nothing to the download — or drop a file on the screen or choose
  **Open audio file…**; your files join the list, and when a track ends the next
  one plays. In the built-in tracks the redraw rate of each picture is the pitch
  you hear. Like a real CRT, the beam is
  dim where it moves fast, so the jumps between parts of a picture nearly vanish
  while the slow strokes burn bright.
- **Live circles** (in Music mode): two oscilloscope circles generated live that
  spin and morph with what you play and sing. The lower-left one follows the
  music — a playing track, or keys you hold — and the upper-right one follows
  your voice. Louder spins faster and blooms the circle into a flower; each note
  sets the petal count, one more per step around the Circle of Fifths (C 2, G 3,
  D 4 …), crossfading between notes; a rising melody spins one way and a falling
  one the other; a sudden loud note kicks both. A track playing underneath is
  heard and followed but not drawn. The circles' own tone is muted unless you turn
  on **Circle tone**, so it doesn't drown the music or feed back into the mic.
- **Spectrum analyzer** along the bottom of the screen, on a log axis from 20 Hz
  to 20 kHz: a red fill for the energy, a white line for the live spectrum and a
  fainter one for peaks that fall back slowly, smoothed over a sixth of an octave.
  It freezes with Run / Stop and can be hidden.
- **Phosphor**: the picture views (Shapes, X–Y, Music) glow in pink, green, amber
  or blue on a bare plum-black screen; Y–T and X–Y keep the graticule, and Y–T
  keeps the usual CH1 yellow / CH2 cyan.
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
src/js/daw/             model.js (song, patterns, playlist, mixer, undo) · midi-file.js ·
                        instruments.js · mixer.js · engine.js · songs-db.js · app.js
src/js/daw/views/       rack.js · piano-roll.js · playlist.js · mixer-view.js · browser.js
src/js/studio/          (the Live page) engine.js · looper.js · looper-worklet.js · fx.js · drums.js ·
                        sounds.js · voice-fx.js · pitch-worklet.js · perf.js ·
                        perf-worklet.js · project.js · library.js · roll.js ·
                        roll-view.js · knob.js · app.js
src/js/scope/           engine.js · capture-worklet.js · live.js · live-worklet.js ·
                        tracks.js · display.js · measure.js · app.js
src/js/chrome.js        window chrome shared by every page
src/js/app.js           wiring
tests/theory.test.mjs   npm test
```

`npm test` covers the wheel arithmetic, the tension ordering above, the
consonant-collapses / dissonant-spreads colour behaviour, chord naming, the just
ratios, the piano tuning curve, that each figure spins at its real beat rate, and
the oscilloscope's trigger interpolation, peak-to-peak, RMS and dBFS, the
beatmaker's song model (steps and notes, pattern and song playback, loops and
clip repeats, beats, undo, loading untrusted files), MIDI file reading and writing,
the looper's timing (latency, bar snapping, pre-roll, undo and redo, one output per
layer, saving and loading), the .prism file format, the stutter and tape-stop
pads, the pitch shifter and autotune, the piano roll's pattern, undo and timing, the effect curves, the beat patterns and
kits, the sound library, chord mode, and the main process's URL, path and permission rules.

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
