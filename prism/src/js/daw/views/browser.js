/**
 * Browser: everything you can add, FL style, down the left.
 *
 *   Instruments  every synth sound, by group: click to hear it, + to add a channel
 *   Drums        each drum: click to hear it, + to add a channel
 *   Kits         click to put every drum channel on that kit
 *   Beats        click to write a ready-made beat into the current pattern
 */

import { SOUNDS, GROUPS } from '../../studio/sounds.js';
import { KITS, BEATS } from '../../studio/drums.js';
import { DRUMS } from '../model.js';

const KIT_LABELS = { classic: 'Classic', boom: 'Boom (trap)', lofi: 'Lo-fi', hyper: 'Hyper', rage: 'Rage', club: 'Club', rock: 'Rock' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class Browser {
  constructor(root, studio) {
    this.root = root;
    this.studio = studio;
    this.open = new Set(['beats', 'drums']);
    this.render();
  }

  section(id, title, fill) {
    const sec = el('section', `br-section${this.open.has(id) ? ' is-open' : ''}`);
    const head = el('button', 'br-head', title);
    head.setAttribute('aria-expanded', String(this.open.has(id)));
    head.addEventListener('click', () => {
      if (this.open.has(id)) this.open.delete(id);
      else this.open.add(id);
      this.render();
    });
    sec.appendChild(head);
    if (this.open.has(id)) {
      const body = el('div', 'br-body');
      fill(body);
      sec.appendChild(body);
    }
    return sec;
  }

  item(label, { hear, add, title, hint }) {
    const row = el('div', 'br-item');
    const name = el('button', 'br-name', label);
    name.title = title ?? (add ? 'Click to hear · + adds it to the Channel Rack' : '');
    name.addEventListener('click', hear);
    name.addEventListener('dblclick', () => add?.());
    row.appendChild(name);
    if (hint) row.appendChild(el('span', 'br-hint', hint));
    if (add) {
      const plus = el('button', 'br-add', '+');
      plus.title = 'Add to the Channel Rack';
      plus.addEventListener('click', add);
      row.appendChild(plus);
    }
    return row;
  }

  render() {
    const root = this.root;
    root.innerHTML = '';
    const s = this.studio;
    root.appendChild(this.section('beats', 'Beats', (b) => {
      for (const [id, beat] of Object.entries(BEATS)) {
        b.appendChild(this.item(beat.label, {
          hint: `${beat.tempo}`,
          title: `Write a ${beat.label} beat into the current pattern (${beat.tempo} BPM)`,
          hear: () => s.applyBeat(id)
        }));
      }
    }));
    root.appendChild(this.section('drums', 'Drums', (b) => {
      for (const [id, d] of Object.entries(DRUMS)) {
        b.appendChild(this.item(d.label, {
          hear: () => s.audition({ kind: 'drum', drum: id, kit: s.kit }),
          add: () => s.addChannel({ kind: 'drum', drum: id, kit: s.kit })
        }));
      }
    }));
    root.appendChild(this.section('kits', 'Kits', (b) => {
      for (const id of Object.keys(KITS)) {
        b.appendChild(this.item(KIT_LABELS[id] ?? id, {
          title: 'Put every drum channel on this kit',
          hear: () => s.useKit(id)
        }));
      }
    }));
    for (const g of GROUPS) {
      root.appendChild(this.section(`g:${g.id}`, g.label, (b) => {
        for (const [id, p] of Object.entries(SOUNDS)) {
          if (p.group !== g.id) continue;
          b.appendChild(this.item(p.label, {
            hear: () => s.audition({ kind: 'synth', sound: id }),
            add: () => s.addChannel({ kind: 'synth', sound: id })
          }));
        }
      }));
    }
  }
}
