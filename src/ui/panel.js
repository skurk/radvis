// Sidebar: simulation settings, the wire table and the feed-point selector.

import { AMATEUR_BANDS, MATERIALS, bandFor } from '../core/constants.js';
import { keepMeshDensity, makeWire, suggestedSegments, wavelength, wireLength } from '../core/model.js';
import { PRESETS } from '../core/presets.js';

const COORD_KEYS = [
  ['p1', 0], ['p1', 1], ['p1', 2],
  ['p2', 0], ['p2', 1], ['p2', 2],
];

// Metres, with enough decimals to stay useful at VHF without overflowing the cell.
const fmt = (v) => {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
};

export class Sidebar {
  /**
   * @param {object} refs DOM elements
   * @param {{onChange:(opts?:object)=>void}} handlers
   */
  constructor(refs, handlers) {
    this.refs = refs;
    this.handlers = handlers;
    this.model = null;
    this.rows = new Map();
    this._initStatic();
  }

  _initStatic() {
    const { presetSelect, materialSelect, bandSelect } = this.refs;
    presetSelect.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    materialSelect.innerHTML = Object.entries(MATERIALS)
      .map(([k, m]) => `<option value="${k}">${m.label}${m.sigma ? ` (${(m.sigma / 1e6).toFixed(1)} MS/m)` : ''}</option>`)
      .join('');
    bandSelect.innerHTML = '<option value="">Band…</option>' +
      AMATEUR_BANDS.map((b) => `<option value="${b.name}">${b.name}</option>`).join('');

    bandSelect.addEventListener('change', () => {
      const band = AMATEUR_BANDS.find((b) => b.name === bandSelect.value);
      bandSelect.value = '';
      if (!band) return;
      this.model.frequencyMHz = Number(((band.start + band.stop) / 2).toFixed(4));
      this.refs.freq.value = String(this.model.frequencyMHz);
      this._updateLambda();
      this.handlers.onChange();
    });

    this.refs.freq.addEventListener('change', () => {
      const v = Number(this.refs.freq.value);
      if (!Number.isFinite(v) || v <= 0) return;
      this.model.frequencyMHz = v;
      this._updateLambda();
      this.handlers.onChange();
    });
    this.refs.groundSelect.addEventListener('change', () => {
      this.model.ground = this.refs.groundSelect.value;
      this.refs.groundHint.hidden = this.model.ground !== 'perfect';
      this.handlers.onChange({ structural: true });
    });
    this.refs.z0.addEventListener('change', () => {
      const v = Number(this.refs.z0.value);
      if (v > 0) {
        this.model.z0 = v;
        this._syncZ0Preset();
        this.handlers.onChange();
      }
    });
    this.refs.z0Preset.addEventListener('change', () => {
      const custom = this.refs.z0Preset.value === 'custom';
      this.refs.z0.hidden = !custom;
      if (custom) {
        this.refs.z0.focus();
        return;
      }
      this.model.z0 = Number(this.refs.z0Preset.value);
      this.refs.z0.value = String(this.model.z0);
      this.handlers.onChange();
    });
    this.refs.advancedGeom.addEventListener('change', () => {
      document.getElementById('app').classList.toggle('advanced', this.refs.advancedGeom.checked);
    });
    this.refs.heightOffset.addEventListener('input', () => {
      this.model.heightOffset = Number(this.refs.heightOffset.value);
      this._updateHeight();
      this.handlers.onChange({ structural: true });
    });
    this.refs.materialSelect.addEventListener('change', () => {
      const sigma = MATERIALS[this.refs.materialSelect.value].sigma;
      for (const w of this.model.wires) w.conductivity = sigma;
      this.handlers.onChange();
    });

    this.refs.addWireBtn.addEventListener('click', () => {
      const lam = wavelength(this.model);
      const w = makeWire({
        name: `Wire ${this.model.wires.length + 1}`,
        p1: [0, 0, 0],
        p2: [0, 0.25 * lam, 0],
        radius: 0.001,
        conductivity: this.model.wires[0]?.conductivity ?? MATERIALS.copper.sigma,
      });
      w.segments = suggestedSegments(w, lam);
      this.model.wires.push(w);
      this.render(this.model, { structural: true });
      this.handlers.onChange({ structural: true });
    });

    this.refs.autoSegBtn.addEventListener('click', () => {
      const lam = wavelength(this.model);
      for (const w of this.model.wires) w.segments = suggestedSegments(w, lam);
      this.render(this.model, { structural: true });
      this.handlers.onChange({ structural: true });
    });

    this.refs.feedWire.addEventListener('change', () => {
      this.model.feed.wireId = this.refs.feedWire.value;
      this._markFeedRow();
      this.handlers.onChange({ structural: true });
    });
    this.refs.feedFraction.addEventListener('input', () => {
      this.model.feed.fraction = Number(this.refs.feedFraction.value);
      this.refs.feedFractionOut.textContent = `${Math.round(this.model.feed.fraction * 100)}%`;
      this.handlers.onChange({ structural: true });
    });

    this.refs.presetSelect.addEventListener('dblclick', () => this.refs.loadPresetBtn.click());
  }

  render(model, { structural = true } = {}) {
    this.model = model;
    this.refs.freq.value = String(model.frequencyMHz);
    this.refs.groundSelect.value = model.ground;
    this.refs.groundHint.hidden = model.ground !== 'perfect';
    this.refs.z0.value = String(model.z0);
    this._syncZ0Preset();
    const sigma = model.wires[0]?.conductivity ?? 0;
    const matKey = Object.keys(MATERIALS).find((k) => MATERIALS[k].sigma === sigma) ?? 'copper';
    this.refs.materialSelect.value = matKey;
    this._updateLambda();

    if (structural) this._buildTable();
    else this.syncValues();

    this.refs.feedWire.innerHTML = model.wires.map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
    this.refs.feedWire.value = model.feed.wireId;
    this.refs.feedFraction.value = String(model.feed.fraction);
    this.refs.feedFractionOut.textContent = `${Math.round(model.feed.fraction * 100)}%`;
    this._markFeedRow();
  }

  /** Refreshes the numeric inputs without rebuilding the DOM (used while dragging). */
  syncValues() {
    for (const w of this.model.wires) {
      const row = this.rows.get(w.id);
      if (!row) continue;
      COORD_KEYS.forEach(([p, i], n) => {
        if (document.activeElement !== row.coords[n]) row.coords[n].value = fmt(w[p][i]);
      });
      if (document.activeElement !== row.radius) row.radius.value = (w.radius * 1000).toFixed(2);
      if (document.activeElement !== row.segments) row.segments.value = String(w.segments);
    }
  }

  _updateLambda() {
    const lam = wavelength(this.model);
    this.refs.lambdaOut.textContent = lam >= 0.5 ? `${lam.toFixed(2)} m` : `${(lam * 1000).toFixed(1)} mm`;
    const band = bandFor(this.model.frequencyMHz);
    this.refs.bandOut.textContent = band
      ? `${band.name} band (${band.start}–${band.stop} MHz)`
      : 'outside the amateur bands';
    this._updateHeight();
  }

  /** The slider reaches one wavelength up, which covers every practical mast. */
  _updateHeight() {
    const max = Math.max(10, Math.min(100, Math.round(wavelength(this.model))));
    const value = Math.min(this.model.heightOffset ?? 0, max);
    this.model.heightOffset = value;
    this.refs.heightOffset.max = String(max);
    this.refs.heightOffset.step = max > 25 ? '0.5' : '0.05';
    this.refs.heightOffset.value = String(value);
    this.refs.heightOut.textContent = `${value.toFixed(value < 10 ? 2 : 1)} m`;
  }

  _markFeedRow() {
    for (const [id, row] of this.rows) row.tr.classList.toggle('feed', id === this.model.feed.wireId);
  }

  _syncZ0Preset() {
    const known = [...this.refs.z0Preset.options].some((o) => o.value === String(this.model.z0));
    this.refs.z0Preset.value = known ? String(this.model.z0) : 'custom';
    this.refs.z0.hidden = known;
  }

  _buildTable() {
    const tbody = this.refs.wireTbody;
    tbody.textContent = '';
    this.rows.clear();

    for (const wire of this.model.wires) {
      const tr = document.createElement('tr');
      const cells = [];

      const nameInput = document.createElement('input');
      nameInput.className = 'name';
      nameInput.value = wire.name;
      nameInput.addEventListener('change', () => {
        wire.name = nameInput.value;
        this.refs.feedWire.querySelector(`option[value="${wire.id}"]`).textContent = wire.name;
      });
      const nameWrap = document.createElement('div');
      nameWrap.className = 'name-cell';
      nameWrap.appendChild(nameInput);
      cells.push(nameWrap);

      const coords = COORD_KEYS.map(([p, i]) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.value = fmt(wire[p][i]);
        input.addEventListener('change', () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          const before = wireLength(wire);
          wire[p][i] = v;
          keepMeshDensity(wire, before);
          this.syncValues();
          this.handlers.onChange({ structural: true });
        });
        cells.push(input);
        return input;
      });

      const radius = document.createElement('input');
      radius.type = 'number';
      radius.step = '0.1';
      radius.min = '0.01';
      radius.value = (wire.radius * 1000).toFixed(2);
      radius.title = 'Wire radius (mm)';
      radius.addEventListener('change', () => {
        const v = Number(radius.value);
        if (v > 0) {
          wire.radius = v / 1000;
          this.handlers.onChange({ structural: true });
        }
      });
      cells.push(radius);

      const segments = document.createElement('input');
      segments.type = 'number';
      segments.step = '1';
      segments.min = '1';
      segments.max = '401';
      segments.value = String(wire.segments);
      segments.title = `Segments — suggested ${suggestedSegments(wire, wavelength(this.model))}`;
      segments.addEventListener('change', () => {
        const v = Math.round(Number(segments.value));
        if (v >= 1) {
          wire.segments = v;
          this.handlers.onChange({ structural: true });
        }
      });
      cells.push(segments);

      cells.forEach((el, i) => {
        const td = document.createElement('td');
        // The last two inputs are the thickness and mesh columns.
        if (i >= cells.length - 2) td.className = 'adv-col';
        td.appendChild(el);
        tr.appendChild(td);
      });

      const del = document.createElement('button');
      del.className = 'icon';
      del.textContent = '✕';
      del.title = `Delete ${wire.name} (${wireLength(wire).toFixed(2)} m long)`;
      del.addEventListener('click', () => {
        if (this.model.wires.length === 1) return;
        this.model.wires = this.model.wires.filter((w) => w.id !== wire.id);
        if (this.model.feed.wireId === wire.id) this.model.feed.wireId = this.model.wires[0].id;
        this.render(this.model, { structural: true });
        this.handlers.onChange({ structural: true });
      });
      nameWrap.appendChild(del);

      tbody.appendChild(tr);
      this.rows.set(wire.id, { tr, coords, radius, segments, nameInput });
    }
  }
}
