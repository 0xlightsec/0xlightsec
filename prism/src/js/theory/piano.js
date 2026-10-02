/**
 * How a real piano is tuned — which is not equal temperament.
 *
 * Piano strings are stiff, so their overtones run sharp of the harmonic series:
 * partial n sits at n·F0·sqrt(1 + B·n²), where B is the string's inharmonicity
 * coefficient. Tuners match an octave by its overlapping partials, not by the
 * fundamentals, so every octave comes out slightly wide and the whole keyboard is
 * stretched: bass flat, treble sharp (the Railsback curve).
 *
 * Model from Rigaud, David & Daudet, "A Parametric Model of Piano Tuning" (DAFx 2011):
 *
 *   B(m)   = e^(sT·m + yT) + e^(sB·m + yB)                       two log-linear asymptotes
 *   ρ(m)   = K/2 · (1 − erf((m − m0) / α)) + 1                   octave type, 2ρ:ρ partials
 *   F0(m)  = F0(m−12) · u·sqrt(1 + B(m−12)·u²) / (v·sqrt(1 + B(m)·v²)),  u = 2ρ, v = ρ
 *
 * with the reference A4 first partial at 440 Hz. The treble asymptote and the octave
 * type centre/height are the paper's fitted values. The bass asymptote and α are
 * fitted per piano in the paper and not given as constants, so the values below are
 * chosen to be physically typical and checked against the Railsback curve in tests.
 *
 * Why it matters here: on an oscilloscope a two-note figure rolls through its phase
 * at the rate the interval misses its just ratio. Using the piano's real tuning, not
 * textbook equal temperament, makes the figures spin the way a piano's would — even
 * an octave, which pure equal temperament says should stand still.
 */

const S_TREBLE = 9.26e-2;   // paper, fitted across pianos
const Y_TREBLE = -13.64;    // paper
const S_BASS = -9.4e-2;     // assumption: mirror slope of the treble asymptote
const Y_BASS = -6.0;        // assumption: B ~ 3.4e-4 at A0, negligible by middle C
const K = 4.51;             // paper, octave-type height
const M0 = 64;              // paper, octave-type centre
const ALPHA = 24;           // assumption: transition spread of about two octaves

const REF_LOW = 60;         // reference octave C4..B4, tuned equal-tempered on first partials
const REF_HIGH = 71;

/** Inharmonicity coefficient for MIDI note m (model clamped to the A0..C8 keyboard). */
export function inharmonicity(m) {
  const k = Math.min(108, Math.max(21, m));
  return Math.exp(S_TREBLE * k + Y_TREBLE) + Math.exp(S_BASS * k + Y_BASS);
}

/** Octave type ρ: the octave above note m is tuned by matching partial 2ρ to ρ. */
export function octaveType(m) {
  return (K / 2) * (1 - erf((m - M0) / ALPHA)) + 1;
}

const F0 = new Float64Array(128);
const F1 = new Float64Array(128);

(function build() {
  for (let m = REF_LOW; m <= REF_HIGH; m++) {
    const f1 = 440 * Math.pow(2, (m - 69) / 12);
    F0[m] = f1 / Math.sqrt(1 + inharmonicity(m));
  }
  // Upward: note m's partial v must coincide with partial u of the note below.
  for (let m = REF_HIGH + 1; m < 128; m++) {
    const rho = octaveType(m);
    const u = 2 * rho;
    const v = rho;
    F0[m] = (F0[m - 12] * u * Math.sqrt(1 + inharmonicity(m - 12) * u * u)) / (v * Math.sqrt(1 + inharmonicity(m) * v * v));
  }
  // Downward: the same coincidence solved for the lower note.
  for (let m = REF_LOW - 1; m >= 0; m--) {
    const rho = octaveType(m + 12);
    const u = 2 * rho;
    const v = rho;
    F0[m] = (F0[m + 12] * v * Math.sqrt(1 + inharmonicity(m + 12) * v * v)) / (u * Math.sqrt(1 + inharmonicity(m) * u * u));
  }
  for (let m = 0; m < 128; m++) F1[m] = F0[m] * Math.sqrt(1 + inharmonicity(m));
})();

/** Frequency of the sounding fundamental (first partial) of piano key m, in Hz. */
export function pianoFrequency(m) {
  const k = Math.round(m);
  return k >= 0 && k < 128 ? F1[k] : 440 * Math.pow(2, (m - 69) / 12);
}

/** Deviation from equal temperament in cents. */
export function stretchCents(m) {
  return 1200 * Math.log2(pianoFrequency(m) / (440 * Math.pow(2, (m - 69) / 12)));
}

/** Abramowitz–Stegun 7.1.26, |error| < 1.5e-7 — plenty for a tuning curve. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
