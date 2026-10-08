/**
 * The Studio's backdrop: a data center in a void. Points of light hang in a slowly
 * turning 3D cloud, wired to their nearest neighbours; packets run along the
 * wires. The music drives it: every drum hit sends a pulse through the nodes and
 * a burst of packets, and the whole thing breathes with the mix's level.
 *
 * Plain canvas 2D, kept cheap: the gradients and glows are drawn once and reused,
 * and the wires go out in a handful of batched strokes. It never takes input.
 */

const TAU = Math.PI * 2;
const CYAN = [88, 230, 255];
const MAGENTA = [255, 79, 216];
const VIOLET = [150, 120, 255];
const FOV = 1.6;          // perspective strength
const DEPTH = 3.2;        // camera distance from the cloud's centre
const LINKS = 3;          // wires per node, to its nearest neighbours
const MAX_PACKETS = 140;

/** Small seeded random numbers, so the cloud has the same shape every launch. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
const BUCKETS = 6; // wire brightness levels, one stroke each

/** A soft round glow in a colour, drawn once and stamped wherever a node shines. */
function glowSprite([r, g, b]) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
  grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.35)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  return c;
}

export class DataCenter {
  constructor(canvas, { count = 150, seed = 7 } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.angle = 0.6;
    this.tilt = 0.32;
    this.pulse = 0;
    this.level = 0;
    this.time = 0;
    this.packets = [];
    this.calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.sprites = new Map([CYAN, MAGENTA, VIOLET].map((c) => [c, glowSprite(c)]));
    this.build(count, seed);
  }

  /** Nodes in racks and loose in the void, and the wires between them. */
  build(count, seed) {
    const r = random(seed);
    const nodes = [];
    // Racks: columns of nodes stacked up, like servers in rows.
    const racks = 9;
    for (let k = 0; k < racks; k++) {
      const x = -1.6 + (3.2 * k) / (racks - 1) + (r() - 0.5) * 0.15;
      const z = (k % 2 ? 0.55 : -0.55) + (r() - 0.5) * 0.3;
      const stack = 5 + Math.floor(r() * 4);
      for (let i = 0; i < stack; i++) nodes.push({ x, y: -0.9 + (1.8 * i) / (stack - 1), z, rack: true });
    }
    // Loose points scattered through the void around them.
    while (nodes.length < count) {
      const u = r() * TAU;
      const v = Math.acos(2 * r() - 1);
      const d = 0.6 + Math.pow(r(), 0.6) * 1.9;
      nodes.push({ x: Math.cos(u) * Math.sin(v) * d * 1.3, y: Math.cos(v) * d * 0.8, z: Math.sin(u) * Math.sin(v) * d, rack: false });
    }
    for (const n of nodes) {
      const x = r();
      n.color = x < 0.68 ? CYAN : x < 0.88 ? MAGENTA : VIOLET;
      n.size = n.rack ? 1.7 : 0.8 + r() * 1.4;
      n.phase = r() * TAU;
      n.glow = 0;
      n.label = r() < 0.1 ? `0x${Math.floor(r() * 0xffff).toString(16).padStart(4, '0').toUpperCase()}` : null;
    }
    // Wires: each node to its nearest few; racks also to the node above.
    const edges = new Map();
    const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    nodes.forEach((n, i) => {
      const near = nodes
        .map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 + (m.z - n.z) ** 2 }))
        .filter((e) => e.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, LINKS);
      for (const { j, d } of near) if (d < 1.1) edges.set(key(i, j), [Math.min(i, j), Math.max(i, j)]);
    });
    this.nodes = nodes;
    this.edges = [...edges.values()];
    this.adj = nodes.map(() => []);
    this.edges.forEach(([a, b], e) => {
      this.adj[a].push(e);
      this.adj[b].push(e);
    });
    this.rand = random(seed + 1);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.paints = null;
    }
    this.dpr = dpr;
    this.w = w / dpr;
    this.h = h / dpr;
    if (!this.paints) {
      // The void (deep blue in the middle, black at the edges) only changes with
      // the window's size: paint it once, at a quarter of the pixels (it's all
      // soft gradient), and copy it in each frame.
      const base = document.createElement('canvas');
      base.width = Math.max(1, Math.round(this.w / 2));
      base.height = Math.max(1, Math.round(this.h / 2));
      const b = base.getContext('2d');
      const W = base.width, H = base.height;
      const bg = b.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      bg.addColorStop(0, '#081526');
      bg.addColorStop(0.55, '#040a14');
      bg.addColorStop(1, '#010205');
      b.fillStyle = bg;
      b.fillRect(0, 0, W, H);
      const vg = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.8);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
      b.fillStyle = vg;
      b.fillRect(0, 0, W, H);
      this.paints = { base };
    }
  }

  /** Send packets off from a node along its wires. */
  spawn(count) {
    for (let k = 0; k < count && this.packets.length < MAX_PACKETS; k++) {
      const e = Math.floor(this.rand() * this.edges.length);
      const [a, b] = this.edges[e];
      const forward = this.rand() < 0.5;
      this.packets.push({ e, from: forward ? a : b, to: forward ? b : a, t: 0, speed: 0.6 + this.rand() * 1.2, hops: 1 + Math.floor(this.rand() * 3) });
    }
  }

  /**
   * One frame. `level` is the mix's loudness (0..1), `hit` true on a drum hit.
   */
  draw(dt, { level = 0, hit = false } = {}) {
    // Thirty frames a second is plenty for a slow drift, and halves the cost.
    this.owed = (this.owed ?? 0) + dt;
    if (hit) this.hitOwed = true;
    if (this.owed < 1 / 32) return;
    dt = Math.min(0.1, this.owed);
    hit = this.hitOwed ?? false;
    this.owed = 0;
    this.hitOwed = false;
    this.resize();
    const { g, w, h } = this;
    const speed = this.calm ? 0.25 : 1;
    this.time += dt;
    this.level += (level - this.level) * Math.min(1, dt * 8);
    if (hit) {
      this.pulse = 1;
      this.spawn(6 + Math.round(this.level * 10));
      const n = this.nodes[Math.floor(this.rand() * this.nodes.length)];
      n.glow = 1;
    }
    this.pulse = Math.max(0, this.pulse - dt * 2.2);
    if (this.rand() < dt * (1.5 + this.level * 6)) this.spawn(1);
    this.angle += dt * (0.035 + this.level * 0.05) * speed;
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.paints.base, 0, 0, w, h);

    // A faint floor grid far below, receding.
    this.floor(g, w, h, ca, sa, ct, st);

    // Project every node.
    const scale = Math.min(w, h) * 0.62;
    const P = this.nodes.map((n) => {
      const x = n.x * ca - n.z * sa;
      const z0 = n.x * sa + n.z * ca;
      const y = n.y * ct - z0 * st;
      const z = n.y * st + z0 * ct + DEPTH;
      const k = FOV / z;
      return { x: w * 0.5 + x * k * scale, y: h * 0.48 + y * k * scale, z, k };
    });
    const fade = (z) => Math.max(0, Math.min(1, (DEPTH + 2.2 - z) / 3.6));

    // Wires, sorted into a few brightness levels by depth and stroked a level at a time.
    g.lineWidth = 1;
    const paths = [CYAN, MAGENTA].map(() => Array.from({ length: BUCKETS }, () => new Path2D()));
    for (const [a, b] of this.edges) {
      const p = P[a], q = P[b];
      const level = Math.min(BUCKETS - 1, Math.floor(fade((p.z + q.z) / 2) * BUCKETS));
      const hot = this.nodes[a].color === MAGENTA && this.nodes[b].color === MAGENTA ? 1 : 0;
      const path = paths[hot][level];
      path.moveTo(p.x, p.y);
      path.lineTo(q.x, q.y);
    }
    paths.forEach((levels, hot) => levels.forEach((path, level) => {
      g.strokeStyle = rgba(hot ? MAGENTA : CYAN, 0.05 + (0.16 * (level + 0.5)) / BUCKETS + this.pulse * 0.06);
      g.stroke(path);
    }));

    // Packets running along the wires, hopping on to the next one or two.
    const live = [];
    for (const pk of this.packets) {
      pk.t += dt * pk.speed * (1 + this.level * 1.5) * speed;
      if (pk.t >= 1) {
        this.nodes[pk.to].glow = Math.max(this.nodes[pk.to].glow, 0.6);
        if (--pk.hops > 0 && this.adj[pk.to].length) {
          const e = this.adj[pk.to][Math.floor(this.rand() * this.adj[pk.to].length)];
          const [a, b] = this.edges[e];
          pk.e = e;
          pk.from = pk.to;
          pk.to = a === pk.from ? b : a;
          pk.t = 0;
        } else continue;
      }
      live.push(pk);
      const p = P[pk.from], q = P[pk.to];
      const at = (t) => [p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t];
      const [x, y] = at(pk.t);
      // A short bright head and a longer faint tail.
      const [x1, y1] = at(Math.max(0, pk.t - 0.07));
      const [x2, y2] = at(Math.max(0, pk.t - 0.2));
      const col = this.nodes[pk.from].color;
      g.lineWidth = 1.4;
      g.strokeStyle = rgba(col, 0.25);
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x, y);
      g.stroke();
      g.strokeStyle = rgba(col, 0.85);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x, y);
      g.stroke();
      g.fillStyle = 'rgba(235, 252, 255, 0.95)';
      g.fillRect(x - 1, y - 1, 2, 2);
    }
    this.packets = live;

    // Nodes, far ones first so near ones sit on top.
    const order = P.map((p, i) => i).sort((a, b) => P[b].z - P[a].z);
    g.font = '9px ui-monospace, Consolas, monospace';
    for (const i of order) {
      const n = this.nodes[i];
      const p = P[i];
      const f = fade(p.z);
      n.glow = Math.max(0, n.glow - dt * 1.4);
      const breathe = 0.5 + 0.5 * Math.sin(this.time * 1.3 + n.phase);
      const energy = Math.min(1, n.glow + this.pulse * 0.5 + this.level * 0.3);
      const size = n.size * p.k * 1.6 * (1 + energy * 0.8);
      const alpha = (0.35 + 0.5 * f) * (0.75 + 0.25 * breathe);
      if (energy > 0.05 || n.rack) {
        const r = size * (5 + energy * 6);
        g.globalAlpha = Math.min(1, 0.22 * alpha + energy * 0.35);
        g.drawImage(this.sprites.get(n.color), p.x - r, p.y - r, r * 2, r * 2);
        g.globalAlpha = 1;
      }
      g.fillStyle = rgba(n.color.map((c) => Math.min(255, c + 70 * energy)), Math.min(1, alpha + energy));
      if (n.rack) g.fillRect(p.x - size, p.y - size * 0.6, size * 2, size * 1.2);
      else {
        g.beginPath();
        g.arc(p.x, p.y, size, 0, TAU);
        g.fill();
      }
      if (n.label && f > 0.45) {
        g.fillStyle = rgba(CYAN, 0.18 + energy * 0.4);
        g.fillText(n.label, p.x + size + 4, p.y - size - 2);
      }
    }

  }

  /** A grid plane under the cloud, turning with it. */
  floor(g, w, h, ca, sa, ct, st) {
    const scale = Math.min(w, h) * 0.62;
    const y0 = 1.25;
    const project = (x0, z0) => {
      const x = x0 * ca - z0 * sa;
      const zz = x0 * sa + z0 * ca;
      const y = y0 * ct - zz * st;
      const z = y0 * st + zz * ct + DEPTH;
      if (z < 0.4) return null;
      const k = FOV / z;
      return [w * 0.5 + x * k * scale, h * 0.48 + y * k * scale, z];
    };
    // Each line in short pieces, so the far end can fade: one stroke per brightness level.
    g.lineWidth = 1;
    const R = 3.2;
    const PIECES = 6;
    const levels = Array.from({ length: BUCKETS }, () => new Path2D());
    for (let i = -8; i <= 8; i++) {
      const v = (i / 8) * R;
      for (const [a, b] of [[[v, -R], [v, R]], [[-R, v], [R, v]]]) {
        for (let k = 0; k < PIECES; k++) {
          const t0 = k / PIECES, t1 = (k + 1) / PIECES;
          const p = project(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0);
          const q = project(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
          if (!p || !q) continue;
          const near = Math.max(0, Math.min(1, 1 - ((p[2] + q[2]) / 2 - DEPTH + 1) / 4));
          const path = levels[Math.min(BUCKETS - 1, Math.floor(near * BUCKETS))];
          path.moveTo(p[0], p[1]);
          path.lineTo(q[0], q[1]);
        }
      }
    }
    levels.forEach((path, level) => {
      g.strokeStyle = rgba(CYAN, (0.075 * (level + 0.5)) / BUCKETS);
      g.stroke(path);
    });
  }
}
