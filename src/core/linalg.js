// Dense complex linear algebra on interleaved Float64Arrays ([re, im, re, im, ...]).
// Matrices are row-major: element (i, j) lives at offset 2 * (i * n + j).

export function createMatrix(n) {
  return new Float64Array(2 * n * n);
}

export function createVector(n) {
  return new Float64Array(2 * n);
}

/**
 * In-place LU factorisation with partial pivoting.
 * @returns {Int32Array} pivot row indices
 */
export function luFactor(A, n) {
  const piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bestMag = -1;
    for (let i = k; i < n; i++) {
      const o = 2 * (i * n + k);
      const mag = A[o] * A[o] + A[o + 1] * A[o + 1];
      if (mag > bestMag) {
        bestMag = mag;
        best = i;
      }
    }
    if (bestMag === 0) throw new Error('Impedance matrix is singular — check the geometry for overlapping or zero-length wires.');
    piv[k] = best;
    if (best !== k) {
      const ro = 2 * k * n;
      const rb = 2 * best * n;
      for (let j = 0; j < 2 * n; j++) {
        const t = A[ro + j];
        A[ro + j] = A[rb + j];
        A[rb + j] = t;
      }
    }
    const dk = 2 * (k * n + k);
    const dr = A[dk];
    const di = A[dk + 1];
    const den = dr * dr + di * di;
    for (let i = k + 1; i < n; i++) {
      const oi = 2 * (i * n + k);
      const ar = A[oi];
      const ai = A[oi + 1];
      const mr = (ar * dr + ai * di) / den;
      const mi = (ai * dr - ar * di) / den;
      A[oi] = mr;
      A[oi + 1] = mi;
      if (mr === 0 && mi === 0) continue;
      for (let j = k + 1; j < n; j++) {
        const ok = 2 * (k * n + j);
        const oj = 2 * (i * n + j);
        const kr = A[ok];
        const ki = A[ok + 1];
        A[oj] -= mr * kr - mi * ki;
        A[oj + 1] -= mr * ki + mi * kr;
      }
    }
  }
  return piv;
}

/** Solves L*U*x = b in place on b. */
export function luSolve(A, piv, b, n) {
  // The stored L columns are in the fully permuted ordering, so every row
  // interchange has to be applied to the right-hand side up front.
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p === k) continue;
    const t0 = b[2 * k];
    const t1 = b[2 * k + 1];
    b[2 * k] = b[2 * p];
    b[2 * k + 1] = b[2 * p + 1];
    b[2 * p] = t0;
    b[2 * p + 1] = t1;
  }
  for (let i = 1; i < n; i++) {
    let sr = b[2 * i];
    let si = b[2 * i + 1];
    for (let j = 0; j < i; j++) {
      const o = 2 * (i * n + j);
      const mr = A[o];
      const mi = A[o + 1];
      const xr = b[2 * j];
      const xi = b[2 * j + 1];
      sr -= mr * xr - mi * xi;
      si -= mr * xi + mi * xr;
    }
    b[2 * i] = sr;
    b[2 * i + 1] = si;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = b[2 * i];
    let si = b[2 * i + 1];
    for (let j = i + 1; j < n; j++) {
      const o = 2 * (i * n + j);
      const ar = A[o];
      const ai = A[o + 1];
      const xr = b[2 * j];
      const xi = b[2 * j + 1];
      sr -= ar * xr - ai * xi;
      si -= ar * xi + ai * xr;
    }
    const d = 2 * (i * n + i);
    const dr = A[d];
    const di = A[d + 1];
    const den = dr * dr + di * di;
    b[2 * i] = (sr * dr + si * di) / den;
    b[2 * i + 1] = (si * dr - sr * di) / den;
  }
  return b;
}

export function cdiv(ar, ai, br, bi) {
  const den = br * br + bi * bi;
  return [(ar * br + ai * bi) / den, (ai * br - ar * bi) / den];
}
