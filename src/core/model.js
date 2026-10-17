// Antenna model helpers: construction, validation and serialisation.
// Lengths are in metres, wire radii in metres, frequency in MHz.

import { C0, MATERIALS } from './constants.js';

let nextId = 1;
export function newWireId() {
  return `w${nextId++}`;
}

export function wavelength(model) {
  return C0 / (model.frequencyMHz * 1e6);
}

export function wireLength(wire) {
  return Math.hypot(wire.p2[0] - wire.p1[0], wire.p2[1] - wire.p1[1], wire.p2[2] - wire.p1[2]);
}

export function makeWire(partial = {}) {
  return {
    id: newWireId(),
    name: partial.name ?? 'Wire',
    p1: partial.p1 ? [...partial.p1] : [0, -10, 10],
    p2: partial.p2 ? [...partial.p2] : [0, 10, 10],
    radius: partial.radius ?? 0.001,
    segments: partial.segments ?? 21,
    conductivity: partial.conductivity ?? MATERIALS.copper.sigma,
  };
}

export function makeModel(partial = {}) {
  const wires = (partial.wires ?? [makeWire()]).map((w) => ({ ...makeWire(w), id: w.id ?? newWireId() }));
  const feed = partial.feed ? { ...partial.feed } : { wireId: wires[0].id, fraction: 0.5 };
  if (!wires.some((w) => w.id === feed.wireId)) feed.wireId = wires[0].id;
  return {
    name: partial.name ?? 'Untitled antenna',
    frequencyMHz: partial.frequencyMHz ?? 7.1,
    ground: partial.ground ?? 'free',
    z0: partial.z0 ?? 50,
    heightOffset: partial.heightOffset ?? 0,
    wires,
    feed,
  };
}

/** Segment count that keeps segments at roughly λ/20 and at least 8× the radius. */
export function suggestedSegments(wire, lambda) {
  const len = wireLength(wire);
  if (len <= 0) return 1;
  const byWavelength = Math.ceil(len / (lambda / 20));
  const byRadius = Math.max(1, Math.floor(len / (8 * wire.radius)));
  return Math.max(1, Math.min(Math.max(byWavelength, 1), byRadius, 201));
}

/** Holds the segment length steady when a wire is stretched or shortened. */
export function keepMeshDensity(wire, previousLength) {
  const len = wireLength(wire);
  if (previousLength <= 0 || len <= 0) return;
  const scaled = Math.round(wire.segments * (len / previousLength));
  wire.segments = Math.max(1, Math.min(401, scaled));
}

/** Rotates the antenna 90° clockwise in place, seen from the positive end of the axis. */
export function rotateModel(model, axis) {
  const turn = ([x, y, z]) => (axis === 'x' ? [x, z, -y] : axis === 'y' ? [-z, y, x] : [y, -x, z]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const w of model.wires) {
    for (const p of [w.p1, w.p2]) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
  }
  // Spinning about the antenna's own centre keeps it put; rotating about the
  // world origin would walk it towards the axis and eventually stick there.
  const c = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2);
  const spin = (p) => {
    const r = turn([p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
    return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
  };
  for (const w of model.wires) {
    w.p1 = spin(w.p1);
    w.p2 = spin(w.p2);
  }
  if (model.ground !== 'perfect') return;
  // Image theory is only valid with the whole structure at or above the ground.
  const offset = model.heightOffset ?? 0;
  let lowest = Infinity;
  for (const w of model.wires) lowest = Math.min(lowest, w.p1[2], w.p2[2]);
  lowest += offset;
  if (lowest < 0) {
    for (const w of model.wires) {
      w.p1[2] -= lowest;
      w.p2[2] -= lowest;
    }
  }
}

export function cloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

export function modelToJson(model) {
  return JSON.stringify(model, null, 2);
}

export function modelFromJson(text) {
  const raw = JSON.parse(text);
  if (!Array.isArray(raw.wires) || raw.wires.length === 0) throw new Error('File contains no wires.');
  for (const w of raw.wires) {
    if (!Array.isArray(w.p1) || !Array.isArray(w.p2) || w.p1.length !== 3 || w.p2.length !== 3) {
      throw new Error('Each wire needs p1 and p2 arrays of three numbers.');
    }
  }
  return makeModel(raw);
}
