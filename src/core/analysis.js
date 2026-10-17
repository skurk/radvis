// High level analysis: runs the solver and packages everything the UI needs.

import { C0 } from './constants.js';
import { buildMesh } from './mesh.js';
import { solveCurrents } from './mom.js';
import { computePattern, sampleDirectivity } from './farfield.js';

function swrFrom(zin, z0) {
  const dr = zin.r + z0;
  const di = zin.x;
  const nr = zin.r - z0;
  const den = dr * dr + di * di;
  const gr = (nr * dr + di * di) / den;
  const gi = (di * dr - nr * di) / den;
  const mag = Math.min(0.999999, Math.hypot(gr, gi));
  return { gamma: mag, swr: (1 + mag) / (1 - mag), returnLoss: -20 * Math.log10(Math.max(mag, 1e-9)) };
}

/** Current magnitude at the midpoint of every segment, for 3D colouring. */
function segmentCurrents(mesh, I) {
  const out = new Float64Array(mesh.segments.length);
  const re = new Float64Array(mesh.segments.length);
  const im = new Float64Array(mesh.segments.length);
  mesh.bases.forEach((basis, j) => {
    const ir = I[2 * j];
    const ii = I[2 * j + 1];
    for (const e of basis.entries) {
      const seg = mesh.segments[e.seg];
      const align = e.ux * seg.dir[0] + e.uy * seg.dir[1] + e.uz * seg.dir[2];
      re[e.seg] += 0.5 * ir * align;
      im[e.seg] += 0.5 * ii * align;
    }
  });
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

function cutData(pattern, efficiency, kind, fixedDeg) {
  const points = [];
  const step = pattern.stepDeg;
  for (let a = 0; a <= 360; a += step) {
    let theta;
    let phi;
    if (kind === 'azimuth') {
      theta = fixedDeg;
      phi = a;
    } else if (a <= 180) {
      theta = a;
      phi = fixedDeg;
    } else {
      theta = 360 - a;
      phi = fixedDeg + 180;
    }
    const d = sampleDirectivity(pattern, theta, phi) * efficiency;
    points.push({ angle: a, dbi: d > 0 ? 10 * Math.log10(d) : -999 });
  }
  return points;
}

export function analyze(model, options = {}) {
  const frequency = model.frequencyMHz * 1e6;
  const lambda = C0 / frequency;
  const mesh = buildMesh(model);
  const { I, zin, feedCurrent } = solveCurrents(mesh, frequency, model.ground);
  const pattern = computePattern(mesh, I, frequency, model.ground, { stepDeg: options.stepDeg ?? 5 });

  const pIn = 0.5 * feedCurrent.re; // 1 V delta-gap excitation
  const efficiency = pIn > 0 ? Math.min(1, pattern.pRad / pIn) : 0;
  const directivity = pattern.pRad > 0 ? (4 * Math.PI * pattern.uMax) / pattern.pRad : 0;
  const gain = directivity * efficiency;

  const backTheta = model.ground === 'perfect' ? pattern.maxTheta : 180 - pattern.maxTheta;
  const back = sampleDirectivity(pattern, backTheta, pattern.maxPhi + 180) * efficiency;
  const fb = back > 0 ? 10 * Math.log10(gain / back) : Infinity;

  // dBi grid used by the 3D surface.
  const gainDb = new Float64Array(pattern.u.length);
  const scale = pattern.pRad > 0 ? (4 * Math.PI * efficiency) / pattern.pRad : 0;
  for (let i = 0; i < gainDb.length; i++) {
    const g = pattern.u[i] * scale;
    gainDb[i] = g > 0 ? 10 * Math.log10(g) : -999;
  }

  return {
    ok: true,
    frequencyMHz: model.frequencyMHz,
    lambda,
    zin,
    ...swrFrom(zin, model.z0),
    z0: model.z0,
    feedCurrent,
    pIn,
    pRad: pattern.pRad,
    efficiency,
    directivityDbi: directivity > 0 ? 10 * Math.log10(directivity) : -999,
    gainDbi: gain > 0 ? 10 * Math.log10(gain) : -999,
    maxTheta: pattern.maxTheta,
    maxPhi: pattern.maxPhi,
    frontToBackDb: Number.isFinite(fb) ? fb : null,
    pattern: {
      stepDeg: pattern.stepDeg,
      thetaCount: pattern.thetaCount,
      phiCount: pattern.phiCount,
      gainDb,
    },
    cuts: {
      azimuth: cutData(pattern, efficiency, 'azimuth', pattern.maxTheta),
      elevation: cutData(pattern, efficiency, 'elevation', pattern.maxPhi),
      azimuthThetaDeg: pattern.maxTheta,
      elevationPhiDeg: pattern.maxPhi,
    },
    segments: mesh.segments.map((s) => ({ p1: s.p1, p2: s.p2, radius: s.radius, wireId: s.wireId })),
    segmentCurrents: segmentCurrents(mesh, I),
    feedPoint: mesh.feedBasis >= 0 ? mesh.nodes[mesh.bases[mesh.feedBasis].node].pos : null,
    basisCount: mesh.bases.length,
    warnings: mesh.warnings,
  };
}

/** Impedance / SWR versus frequency (far field is skipped for speed). */
export function sweep(model, startMHz, stopMHz, points, onProgress) {
  const out = [];
  const n = Math.max(2, points);
  for (let i = 0; i < n; i++) {
    const f = startMHz + ((stopMHz - startMHz) * i) / (n - 1);
    const m = { ...model, frequencyMHz: f };
    try {
      const mesh = buildMesh(m);
      const { zin } = solveCurrents(mesh, f * 1e6, m.ground);
      out.push({ frequencyMHz: f, r: zin.r, x: zin.x, ...swrFrom(zin, m.z0) });
    } catch {
      out.push({ frequencyMHz: f, r: NaN, x: NaN, swr: NaN, gamma: NaN, returnLoss: NaN });
    }
    onProgress?.((i + 1) / n);
  }
  return out;
}
