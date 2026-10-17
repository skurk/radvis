// Converts an antenna model (list of straight wires) into a MoM mesh:
// a list of straight segments plus overlapping triangular (piecewise-linear)
// current basis functions defined around each wire node.

import { C0 } from './constants.js';

const NODE_TOL = 1e-6; // metres — endpoints closer than this are the same node
const GROUND_TOL = 1e-6;

function key(p) {
  return `${Math.round(p[0] / NODE_TOL)}|${Math.round(p[1] / NODE_TOL)}|${Math.round(p[2] / NODE_TOL)}`;
}

/**
 * Builds the discretised mesh.
 * @param {object} model antenna model
 * @returns {{segments:Array, bases:Array, feedBasis:number, warnings:string[]}}
 */
export function buildMesh(model) {
  const warnings = [];
  const lambda = C0 / (model.frequencyMHz * 1e6);
  const segments = [];
  const nodes = [];
  const nodeMap = new Map();

  const nodeIndex = (p) => {
    const k = key(p);
    let idx = nodeMap.get(k);
    if (idx === undefined) {
      idx = nodes.length;
      nodes.push({ pos: [p[0], p[1], p[2]], conns: [] });
      nodeMap.set(k, idx);
    }
    return idx;
  };

  const wireNodeIds = new Map();
  const dz = model.heightOffset ?? 0;

  for (const wire of model.wires) {
    const n = Math.max(1, Math.round(wire.segments));
    const [x1, y1] = wire.p1;
    const [x2, y2] = wire.p2;
    const z1 = wire.p1[2] + dz;
    const z2 = wire.p2[2] + dz;
    const total = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    if (total < 1e-9) {
      warnings.push(`Wire "${wire.name}" has zero length and was ignored.`);
      continue;
    }
    const segLen = total / n;
    if (segLen < 4 * wire.radius) {
      warnings.push(`Wire "${wire.name}": segment length is only ${(segLen / wire.radius).toFixed(1)}× the radius (thin-wire theory needs ≳ 8×). Reduce the segment count or the radius.`);
    }
    if (segLen > lambda / 8) {
      warnings.push(`Wire "${wire.name}": segments are ${(segLen / lambda).toFixed(3)} λ long (use ≤ 0.1 λ for accurate results).`);
    }

    const ids = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      ids.push(nodeIndex([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t]));
    }
    wireNodeIds.set(wire.id, ids);

    for (let i = 0; i < n; i++) {
      const a = nodes[ids[i]].pos;
      const b = nodes[ids[i + 1]].pos;
      const segIdx = segments.length;
      segments.push({
        wireId: wire.id,
        n1: ids[i],
        n2: ids[i + 1],
        p1: a,
        p2: b,
        len: segLen,
        dir: [(b[0] - a[0]) / segLen, (b[1] - a[1]) / segLen, (b[2] - a[2]) / segLen],
        radius: wire.radius,
        sigma: wire.conductivity ?? 0,
      });
      nodes[ids[i]].conns.push({ seg: segIdx, atEnd: 0 });
      nodes[ids[i + 1]].conns.push({ seg: segIdx, atEnd: 1 });
    }
  }

  const groundOn = model.ground === 'perfect';

  // Entry describes the current ramp of one basis function on one segment.
  // r(t) = Q + t * D for t in [0, 1]; current profile p(t) = t; direction u.
  const makeEntry = (conn, nodePos, rise) => {
    const seg = segments[conn.seg];
    const far = conn.atEnd === 1 ? seg.p1 : seg.p2;
    const d = [nodePos[0] - far[0], nodePos[1] - far[1], nodePos[2] - far[2]];
    const s = rise ? 1 : -1;
    return {
      seg: conn.seg,
      qx: far[0], qy: far[1], qz: far[2],
      dx: d[0], dy: d[1], dz: d[2],
      ux: (s * d[0]) / seg.len,
      uy: (s * d[1]) / seg.len,
      uz: (s * d[2]) / seg.len,
      L: seg.len,
      div: s / seg.len,
      radius: seg.radius,
      sigma: seg.sigma,
      rise,
    };
  };

  const bases = [];
  nodes.forEach((node, ni) => {
    const m = node.conns.length;
    if (m >= 2) {
      for (let i = 1; i < m; i++) {
        bases.push({
          node: ni,
          entries: [makeEntry(node.conns[0], node.pos, true), makeEntry(node.conns[i], node.pos, false)],
        });
      }
    } else if (m === 1 && groundOn && Math.abs(node.pos[2]) <= GROUND_TOL) {
      // Wire bonded to the ground plane: the image current continues the ramp,
      // so a half basis (non-zero current at the contact) is the correct choice.
      bases.push({ node: ni, entries: [makeEntry(node.conns[0], node.pos, true)], grounded: true });
    }
  });

  if (groundOn) {
    for (const seg of segments) {
      if (seg.p1[2] < -GROUND_TOL || seg.p2[2] < -GROUND_TOL) {
        warnings.push('Part of the geometry is below the ground plane (z < 0). Results there are not physical.');
        break;
      }
    }
  }

  const feedBasis = resolveFeed(model, wireNodeIds, nodes, bases, segments, warnings);
  return { segments, nodes, bases, feedBasis, warnings, lambda };
}

function resolveFeed(model, wireNodeIds, nodes, bases, segments, warnings) {
  const feed = model.feed;
  const wire = model.wires.find((w) => w.id === feed?.wireId) ?? model.wires[0];
  if (!wire) return -1;
  const ids = wireNodeIds.get(wire.id);
  if (!ids) return -1;
  const n = ids.length - 1;
  const groundedEndsAllowed = model.ground === 'perfect';
  let idx = Math.round((feed?.fraction ?? 0.5) * n);
  idx = Math.min(n, Math.max(0, idx));
  if (!groundedEndsAllowed) idx = Math.min(n - 1, Math.max(1, idx));

  const nodeId = ids[idx];
  const onWire = (b) => b.entries.every((e) => segments[e.seg].wireId === wire.id);
  let candidate = bases.findIndex((b) => b.node === nodeId && onWire(b));
  if (candidate < 0) candidate = bases.findIndex((b) => b.node === nodeId);
  if (candidate < 0) {
    // Fall back to the electrically closest usable basis.
    const target = nodes[nodeId].pos;
    let best = -1;
    let bestD = Infinity;
    bases.forEach((b, i) => {
      const p = nodes[b.node].pos;
      const d = Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) warnings.push('The feed point is at a free wire end; it was moved to the nearest valid node.');
    return best;
  }
  return candidate;
}
