// Thin-wire Electric Field Integral Equation solved with a Galerkin
// method of moments (triangular basis + reduced kernel), optionally with a
// perfectly conducting ground plane at z = 0 handled by image theory.

import { C0, ETA0, MU0 } from './constants.js';
import { createMatrix, createVector, luFactor, luSolve } from './linalg.js';

// 4-point Gauss–Legendre nodes/weights mapped to [0, 1].
const GT = [0.0694318442029737, 0.3300094782075719, 0.6699905217924281, 0.9305681557970263];
const GW = [0.1739274225687269, 0.3260725774312731, 0.3260725774312731, 0.1739274225687269];

const MAX_OUTER = 16;
const INNER_SUB = 2;

/** Squared distance from point p to the segment q0 -> q0 + d. */
function pointSegDist2(px, py, pz, qx, qy, qz, dx, dy, dz, len2) {
  let t = ((px - qx) * dx + (py - qy) * dy + (pz - qz) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (qx + t * dx);
  const ey = py - (qy + t * dy);
  const ez = pz - (qz + t * dz);
  return ex * ex + ey * ey + ez * ez;
}

/**
 * Integrates the potential kernels over a pair of basis entries using
 * singularity extraction: the static 1/R part of the inner integral is
 * evaluated in closed form, the remaining (exp(-jkR) - 1)/R part is smooth.
 *
 * out = [I1re, I1im, I0re, I0im] with
 *   I1 = ∫∫ p_a p_b G dl dl'   and   I0 = ∫∫ G dl dl'
 */
function pairIntegrals(ea, eb, k, mirror, out) {
  const qbx = eb.qx;
  const qby = eb.qy;
  const qbz = mirror ? -eb.qz : eb.qz;
  const dbx = eb.dx;
  const dby = eb.dy;
  const dbz = mirror ? -eb.dz : eb.dz;
  const Lb = eb.L;
  const ubx = dbx / Lb;
  const uby = dby / Lb;
  const ubz = dbz / Lb;
  const a2 = eb.radius * eb.radius;
  const lb2 = Lb * Lb;

  // Closest approach between the two segments drives the outer subdivision.
  let dmin2 = Infinity;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const d2 = pointSegDist2(
      ea.qx + t * ea.dx, ea.qy + t * ea.dy, ea.qz + t * ea.dz,
      qbx, qby, qbz, dbx, dby, dbz, lb2,
    );
    if (d2 < dmin2) dmin2 = d2;
  }
  const scale = Math.max(Math.sqrt(dmin2), 0.5 * (ea.radius + eb.radius));
  const nOuter = Math.min(MAX_OUTER, Math.max(2, Math.ceil((1.2 * ea.L) / scale)));

  let i1r = 0, i1i = 0, i0r = 0, i0i = 0;

  for (let io = 0; io < nOuter; io++) {
    for (let p = 0; p < 4; p++) {
      const ta = (io + GT[p]) / nOuter;
      const wa = GW[p] / nOuter;
      const rx = ea.qx + ta * ea.dx;
      const ry = ea.qy + ta * ea.dy;
      const rz = ea.qz + ta * ea.dz;

      // --- static part, exact ---
      const wx = rx - qbx;
      const wy = ry - qby;
      const wz = rz - qbz;
      const s0 = wx * ubx + wy * uby + wz * ubz;
      const h2 = Math.max(wx * wx + wy * wy + wz * wz - s0 * s0 + a2, 1e-30);
      const h = Math.sqrt(h2);
      const A = -s0;
      const B = Lb - s0;
      const ra = Math.sqrt(A * A + h2);
      const rb = Math.sqrt(B * B + h2);
      const f0 = Math.asinh(B / h) - Math.asinh(A / h);
      const stat0 = f0;
      const stat1 = (rb - ra + s0 * f0) / Lb;

      // --- dynamic remainder (exp(-jkR) - 1)/R, smooth ---
      let d0r = 0, d0i = 0, d1r = 0, d1i = 0;
      for (let ii = 0; ii < INNER_SUB; ii++) {
        for (let q = 0; q < 4; q++) {
          const tb = (ii + GT[q]) / INNER_SUB;
          const wb = (GW[q] / INNER_SUB) * Lb;
          const ex = rx - (qbx + tb * dbx);
          const ey = ry - (qby + tb * dby);
          const ez = rz - (qbz + tb * dbz);
          const R = Math.sqrt(ex * ex + ey * ey + ez * ez + a2);
          const kr = k * R;
          const gr = (Math.cos(kr) - 1) / R;
          const gi = -Math.sin(kr) / R;
          d0r += wb * gr;
          d0i += wb * gi;
          d1r += wb * tb * gr;
          d1i += wb * tb * gi;
        }
      }

      i0r += wa * (stat0 + d0r);
      i0i += wa * d0i;
      i1r += wa * ta * (stat1 + d1r);
      i1i += wa * ta * d1i;
    }
  }

  const La = ea.L;
  out[0] = i1r * La;
  out[1] = i1i * La;
  out[2] = i0r * La;
  out[3] = i0i * La;
}

/** Surface impedance per unit length of a round wire (high-frequency skin effect). */
function surfaceImpedance(sigma, radius, omega) {
  if (!sigma || sigma <= 0) return 0;
  const rs = Math.sqrt((omega * MU0) / (2 * sigma));
  return rs / (2 * Math.PI * radius);
}

/**
 * Assembles the N×N complex impedance matrix of the structure.
 */
export function fillImpedanceMatrix(mesh, frequency, ground) {
  const bases = mesh.bases;
  const n = bases.length;
  const Z = createMatrix(n);
  const omega = 2 * Math.PI * frequency;
  const k = omega / C0;
  const pre = ETA0 / (4 * Math.PI);
  const useImage = ground === 'perfect';
  const buf = new Float64Array(4);

  for (let m = 0; m < n; m++) {
    const em = bases[m].entries;
    for (let p = m; p < n; p++) {
      const ep = bases[p].entries;
      let tr = 0;
      let ti = 0;
      for (const ea of em) {
        for (const eb of ep) {
          const dot = ea.ux * eb.ux + ea.uy * eb.uy + ea.uz * eb.uz;
          const dd = ea.div * eb.div;
          pairIntegrals(ea, eb, k, false, buf);
          tr += k * dot * buf[0] - (dd / k) * buf[2];
          ti += k * dot * buf[1] - (dd / k) * buf[3];
          if (useImage) {
            const dotI = ea.ux * eb.ux + ea.uy * eb.uy - ea.uz * eb.uz;
            pairIntegrals(ea, eb, k, true, buf);
            tr -= k * dotI * buf[0] - (dd / k) * buf[2];
            ti -= k * dotI * buf[1] - (dd / k) * buf[3];
          }
        }
      }
      // Z = j * pre * T
      let zr = -pre * ti;
      let zi = pre * tr;

      // Ohmic (internal) impedance of overlapping basis functions.
      for (const ea of em) {
        for (const eb of ep) {
          if (ea.seg !== eb.seg || !ea.sigma) continue;
          const zs = surfaceImpedance(ea.sigma, ea.radius, omega);
          if (!zs) continue;
          const sameParam = ea.qx === eb.qx && ea.qy === eb.qy && ea.qz === eb.qz;
          const overlap = (sameParam ? 1 / 3 : 1 / 6) * ea.L;
          const dot = ea.ux * eb.ux + ea.uy * eb.uy + ea.uz * eb.uz;
          zr += zs * overlap * dot;
          zi += zs * overlap * dot;
        }
      }

      const o1 = 2 * (m * n + p);
      Z[o1] = zr;
      Z[o1 + 1] = zi;
      if (p !== m) {
        const o2 = 2 * (p * n + m);
        Z[o2] = zr;
        Z[o2 + 1] = zi;
      }
    }
  }
  return Z;
}

/**
 * Solves for the basis-function currents produced by a 1 V delta-gap source.
 * @returns {{I: Float64Array, zin:{r:number,x:number}, feedCurrent:{re:number,im:number}}}
 */
export function solveCurrents(mesh, frequency, ground) {
  const n = mesh.bases.length;
  if (n === 0) throw new Error('No current basis functions: give each wire at least 2 segments, or connect the wires.');
  if (mesh.feedBasis < 0) throw new Error('Could not place the feed point on the structure.');

  const Z = fillImpedanceMatrix(mesh, frequency, ground);
  const piv = luFactor(Z, n);
  const I = createVector(n);
  I[2 * mesh.feedBasis] = 1; // 1 V excitation
  luSolve(Z, piv, I, n);

  const fr = I[2 * mesh.feedBasis];
  const fi = I[2 * mesh.feedBasis + 1];
  const den = fr * fr + fi * fi;
  if (den === 0) throw new Error('Feed current solved to zero — the feed point is not connected to the structure.');
  return {
    I,
    feedCurrent: { re: fr, im: fi },
    zin: { r: fr / den, x: -fi / den },
  };
}
