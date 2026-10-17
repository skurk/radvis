// Far-field radiation pattern, directivity, gain and radiated power
// obtained from the method-of-moments current solution.

import { C0, ETA0 } from './constants.js';

// 6-point Gauss–Legendre nodes/weights on [0, 1].
const FT = [0.0337652428984240, 0.1693953067668678, 0.3806904069584015, 0.6193095930415985, 0.8306046932331322, 0.9662347571015760];
const FW = [0.0856622461895852, 0.1803807865240693, 0.2339569672863455, 0.2339569672863455, 0.1803807865240693, 0.0856622461895852];

/**
 * Collapses the current solution into a list of weighted radiating point sources.
 * Each point contributes v * exp(j k r̂·r) to the radiation vector N.
 */
function buildSources(mesh, I, ground) {
  const useImage = ground === 'perfect';
  const perEntry = FT.length * (useImage ? 2 : 1);
  let count = 0;
  for (const b of mesh.bases) count += b.entries.length * perEntry;

  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  const v = new Float64Array(count * 6); // vx(re,im), vy(re,im), vz(re,im)

  let i = 0;
  mesh.bases.forEach((basis, j) => {
    const ir = I[2 * j];
    const ii = I[2 * j + 1];
    for (const e of basis.entries) {
      for (let q = 0; q < FT.length; q++) {
        const t = FT[q];
        const w = FW[q] * t * e.L;
        const cr = ir * w;
        const ci = ii * w;
        px[i] = e.qx + t * e.dx;
        py[i] = e.qy + t * e.dy;
        pz[i] = e.qz + t * e.dz;
        const o = i * 6;
        v[o] = cr * e.ux; v[o + 1] = ci * e.ux;
        v[o + 2] = cr * e.uy; v[o + 3] = ci * e.uy;
        v[o + 4] = cr * e.uz; v[o + 5] = ci * e.uz;
        i++;
        if (useImage) {
          px[i] = px[i - 1];
          py[i] = py[i - 1];
          pz[i] = -pz[i - 1];
          const oi = i * 6;
          v[oi] = -cr * e.ux; v[oi + 1] = -ci * e.ux;
          v[oi + 2] = -cr * e.uy; v[oi + 3] = -ci * e.uy;
          v[oi + 4] = cr * e.uz; v[oi + 5] = ci * e.uz;
          i++;
        }
      }
    }
  });
  return { px, py, pz, v, count: i };
}

/**
 * Computes the full-sphere gain pattern.
 * @returns pattern grid, radiated power and directivity statistics
 */
export function computePattern(mesh, I, frequency, ground, options = {}) {
  const stepDeg = options.stepDeg ?? 5;
  const k = (2 * Math.PI * frequency) / C0;
  const src = buildSources(mesh, I, ground);
  const groundOn = ground === 'perfect';

  const thetaCount = Math.round(180 / stepDeg) + 1;
  const phiCount = Math.round(360 / stepDeg) + 1;
  const dTheta = (Math.PI / 180) * stepDeg;
  const dPhi = (Math.PI / 180) * stepDeg;

  const u = new Float64Array(thetaCount * phiCount); // radiation intensity W/sr
  const eTheta = new Float64Array(thetaCount * phiCount);
  const ePhi = new Float64Array(thetaCount * phiCount);

  const uFactor = (ETA0 * k * k) / (32 * Math.PI * Math.PI);
  // With a ground plane the integration stops at the horizon, which then
  // becomes a trapezoid endpoint and only gets half weight.
  const lastTheta = groundOn ? Math.round(90 / stepDeg) : thetaCount - 1;
  let pRad = 0;

  for (let it = 0; it < thetaCount; it++) {
    const th = it * dTheta;
    const st = Math.sin(th);
    const ct = Math.cos(th);
    const blocked = groundOn && it > lastTheta;
    for (let ip = 0; ip < phiCount; ip++) {
      const idx = it * phiCount + ip;
      if (blocked) continue;
      const ph = ip * dPhi;
      const sp = Math.sin(ph);
      const cp = Math.cos(ph);
      const rx = st * cp;
      const ry = st * sp;
      const rz = ct;

      let nxr = 0, nxi = 0, nyr = 0, nyi = 0, nzr = 0, nzi = 0;
      for (let i = 0; i < src.count; i++) {
        const phase = k * (rx * src.px[i] + ry * src.py[i] + rz * src.pz[i]);
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const o = i * 6;
        const ar = src.v[o], ai = src.v[o + 1];
        nxr += ar * c - ai * s; nxi += ar * s + ai * c;
        const br = src.v[o + 2], bi = src.v[o + 3];
        nyr += br * c - bi * s; nyi += br * s + bi * c;
        const dr = src.v[o + 4], di = src.v[o + 5];
        nzr += dr * c - di * s; nzi += dr * s + di * c;
      }

      const tr = ct * cp * nxr + ct * sp * nyr - st * nzr;
      const ti = ct * cp * nxi + ct * sp * nyi - st * nzi;
      const pr = -sp * nxr + cp * nyr;
      const pi = -sp * nxi + cp * nyi;

      const mag2 = tr * tr + ti * ti + pr * pr + pi * pi;
      u[idx] = uFactor * mag2;
      eTheta[idx] = Math.sqrt(tr * tr + ti * ti);
      ePhi[idx] = Math.sqrt(pr * pr + pi * pi);

      if (ip < phiCount - 1) {
        const wTheta = it === 0 || it === lastTheta ? 0.5 : 1;
        pRad += u[idx] * st * dTheta * dPhi * wTheta;
      }
    }
  }

  let uMax = 0;
  let maxIdx = 0;
  for (let i = 0; i < u.length; i++) {
    if (u[i] > uMax) {
      uMax = u[i];
      maxIdx = i;
    }
  }

  return {
    stepDeg,
    thetaCount,
    phiCount,
    u,
    eTheta,
    ePhi,
    pRad,
    uMax,
    maxTheta: Math.floor(maxIdx / phiCount) * stepDeg,
    maxPhi: ((maxIdx % phiCount) * stepDeg) % 360,
  };
}

export function sampleDirectivity(pattern, thetaDeg, phiDeg) {
  const { thetaCount, phiCount, stepDeg, u, pRad } = pattern;
  let t = Math.round(thetaDeg / stepDeg);
  let p = Math.round(((phiDeg % 360) + 360) % 360 / stepDeg);
  t = Math.min(thetaCount - 1, Math.max(0, t));
  p = Math.min(phiCount - 1, Math.max(0, p));
  const value = u[t * phiCount + p];
  return pRad > 0 ? (4 * Math.PI * value) / pRad : 0;
}
