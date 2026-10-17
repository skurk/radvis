// Ready-made amateur radio antennas. Geometry is derived from the design
// wavelength so the shapes stay meaningful if the frequency is changed.

import { C0, MATERIALS } from './constants.js';
import { makeModel, makeWire } from './model.js';

const CU = MATERIALS.copper.sigma;
const AL = MATERIALS.aluminium.sigma;

// Common wire and tubing sizes, as radius in metres.
const AWG12 = 0.001026;
const AWG14 = 0.000814;
const ROD_6MM = 0.003;
const TUBE_25MM = 0.0127;
const TUBE_50MM = 0.025;

function lambdaOf(fMHz) {
  return C0 / (fMHz * 1e6);
}

function build({ name, fMHz, ground = 'free', wires, feedIndex = 0, feedFraction = 0.5, z0 = 50 }) {
  const model = makeModel({ name, frequencyMHz: fMHz, ground, wires, z0 });
  model.feed = { wireId: model.wires[feedIndex].id, fraction: feedFraction };
  return model;
}

/** Classic 40 m half-wave dipole on a 10 m mast. */
function dipole40(fMHz = 7.1) {
  const L = lambdaOf(fMHz);
  const half = 0.2385 * L;
  const h = 10;
  return build({
    name: '40 m dipole, 10 m high',
    fMHz,
    ground: 'perfect',
    wires: [makeWire({ name: 'Dipole', p1: [0, -half, h], p2: [0, half, h], radius: AWG12, segments: 41, conductivity: CU })],
  });
}

/** 20 m inverted-V, apex on a 12 m mast, 90° included angle. */
function invertedV20(fMHz = 14.15) {
  const L = lambdaOf(fMHz);
  const leg = 0.2497 * L;
  const run = leg * Math.SQRT1_2;
  const apex = 12;
  return build({
    name: '20 m inverted-V, 12 m apex',
    fMHz,
    ground: 'perfect',
    wires: [
      makeWire({ name: 'Leg north', p1: [0, 0, apex], p2: [0, run, apex - run], radius: AWG14, segments: 21, conductivity: CU }),
      makeWire({ name: 'Leg south', p1: [0, 0, apex], p2: [0, -run, apex - run], radius: AWG14, segments: 21, conductivity: CU }),
    ],
    feedFraction: 0,
  });
}

/** Full-size 3-element monoband beam, quoted in free space like the catalogues. */
function yagi20(fMHz = 14.15) {
  const L = lambdaOf(fMHz);
  const el = (name, halfLen, x) => makeWire({
    name,
    p1: [x, -halfLen * L, 0],
    p2: [x, halfLen * L, 0],
    radius: TUBE_25MM,
    segments: 21,
    conductivity: AL,
  });
  return build({
    name: '20 m 3-element Yagi (free space)',
    fMHz,
    wires: [
      el('Driven element', 0.239, 0),
      el('Reflector', 0.25, -0.2 * L),
      el('Director', 0.22, 0.15 * L),
    ],
  });
}

/** Delta loop fed a quarter wave from the apex, which makes it vertically polarised. */
function deltaLoop20(fMHz = 14.15) {
  const L = lambdaOf(fMHz);
  const perimeter = 1.075 * L;
  const side = perimeter / 3;
  const halfBase = side / 2;
  const base = 6;
  const apex = base + (side * Math.sqrt(3)) / 2;
  const wire = (name, p1, p2) => makeWire({ name, p1, p2, radius: AWG12, segments: 15, conductivity: CU });
  return build({
    name: '20 m delta loop, vertically polarised',
    fMHz,
    ground: 'perfect',
    wires: [
      wire('Base', [0, -halfBase, base], [0, halfBase, base]),
      wire('East side', [0, halfBase, base], [0, 0, apex]),
      wire('West side', [0, 0, apex], [0, -halfBase, base]),
    ],
    feedIndex: 1,
    feedFraction: 1 - (0.25 * L) / side,
  });
}

/** Folded dipole on 300 Ω ladder line. */
function foldedDipole20(fMHz = 14.15) {
  const L = lambdaOf(fMHz);
  const half = 0.239 * L;
  const s = 0.15;
  const long = (name, x) => makeWire({ name, p1: [x, -half, 0], p2: [x, half, 0], radius: AWG12, segments: 41, conductivity: CU });
  const link = (name, y) => makeWire({ name, p1: [0, y, 0], p2: [s, y, 0], radius: AWG12, segments: 1, conductivity: CU });
  return build({
    name: '20 m folded dipole (300 Ω)',
    fMHz,
    wires: [long('Driven side', 0), long('Return side', s), link('North link', half), link('South link', -half)],
    z0: 300,
  });
}

/** Ground-mounted quarter-wave vertical with an ideal radial field. */
function vertical80(fMHz = 3.65) {
  const L = lambdaOf(fMHz);
  return build({
    name: '80 m quarter-wave vertical',
    fMHz,
    ground: 'perfect',
    wires: [makeWire({ name: 'Radiator', p1: [0, 0, 0], p2: [0, 0, 0.242 * L], radius: TUBE_50MM, segments: 21, conductivity: AL })],
    feedFraction: 0,
  });
}

/** Full-wave square loop lying flat 12 m up — the classic quiet NVIS antenna. */
function horizontalLoop80(fMHz = 3.65) {
  const L = lambdaOf(fMHz);
  const half = (1.018 * L) / 8;
  const h = 12;
  const corners = [
    [-half, -half, h],
    [half, -half, h],
    [half, half, h],
    [-half, half, h],
  ];
  const names = ['South side', 'East side', 'North side', 'West side'];
  const wires = corners.map((p, i) => makeWire({
    name: names[i],
    p1: p,
    p2: corners[(i + 1) % 4],
    radius: AWG12,
    segments: 21,
    conductivity: CU,
  }));
  return build({ name: '80 m full-wave horizontal loop', fMHz, ground: 'perfect', wires });
}

/** Top-band inverted-L: 18 m up the tower, then a horizontal flat top. */
function invertedL160(fMHz = 1.835) {
  const L = lambdaOf(fMHz);
  const vertical = 18;
  const flatTop = 0.2505 * L - vertical;
  return build({
    name: '160 m inverted-L',
    fMHz,
    ground: 'perfect',
    wires: [
      makeWire({ name: 'Vertical', p1: [0, 0, 0], p2: [0, 0, vertical], radius: AWG12, segments: 19, conductivity: CU }),
      makeWire({ name: 'Flat top', p1: [0, 0, vertical], p2: [flatTop, 0, vertical], radius: AWG12, segments: 23, conductivity: CU }),
    ],
    feedFraction: 0,
  });
}

/** The classic first build: 2 m quarter-wave ground plane with drooping radials. */
function groundPlane2m(fMHz = 146) {
  const L = lambdaOf(fMHz);
  const run = 0.26 * L * Math.SQRT1_2;
  const wires = [makeWire({ name: 'Radiator', p1: [0, 0, 0], p2: [0, 0, 0.2295 * L], radius: 0.001, segments: 11, conductivity: CU })];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    wires.push(makeWire({
      name: `Radial ${i + 1}`,
      p1: [0, 0, 0],
      p2: [run * Math.cos(a), run * Math.sin(a), -run],
      radius: 0.001,
      segments: 11,
      conductivity: CU,
    }));
  }
  return build({ name: '2 m ground plane, 45° radials', fMHz, wires, feedFraction: 0 });
}

/** Portable 3-element beam for 2 m SSB. */
function yagi2m(fMHz = 145) {
  const L = lambdaOf(fMHz);
  const el = (name, halfLen, x) => makeWire({
    name,
    p1: [x, -halfLen * L, 0],
    p2: [x, halfLen * L, 0],
    radius: ROD_6MM,
    segments: 15,
    conductivity: AL,
  });
  return build({
    name: '2 m 3-element Yagi',
    fMHz,
    wires: [
      el('Driven element', 0.239, 0),
      el('Reflector', 0.25, -0.2 * L),
      el('Director', 0.22, 0.15 * L),
    ],
  });
}

export const PRESETS = [
  { id: 'dipole40', label: '40 m dipole, 10 m high (7.1 MHz)', create: () => dipole40() },
  { id: 'invv20', label: '20 m inverted-V, 12 m apex (14.15 MHz)', create: () => invertedV20() },
  { id: 'yagi20', label: '20 m 3-element Yagi (14.15 MHz)', create: () => yagi20() },
  { id: 'delta20', label: '20 m delta loop (14.15 MHz)', create: () => deltaLoop20() },
  { id: 'folded20', label: '20 m folded dipole, 300 Ω (14.15 MHz)', create: () => foldedDipole20() },
  { id: 'vert80', label: '80 m quarter-wave vertical (3.65 MHz)', create: () => vertical80() },
  { id: 'loop80', label: '80 m full-wave horizontal loop (3.65 MHz)', create: () => horizontalLoop80() },
  { id: 'invl160', label: '160 m inverted-L (1.835 MHz)', create: () => invertedL160() },
  { id: 'gp2m', label: '2 m ground plane (146 MHz)', create: () => groundPlane2m() },
  { id: 'yagi2m', label: '2 m 3-element Yagi (145 MHz)', create: () => yagi2m() },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}
