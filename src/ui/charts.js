// Lightweight 2D plots (polar pattern cuts and an SWR sweep) on canvas.

const FG = '#ececed';
const MUTED = '#8e8e99';
const GRID = '#3a3a42';
const ACCENT = '#4fc3f7';

function prepare(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 300;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/**
 * Polar plot. `points` is [{angle (deg, 0 = up, clockwise), dbi}].
 */
export function drawPolar(canvas, points, opts = {}) {
  const { ctx, w, h } = prepare(canvas);
  const title = opts.title ?? '';
  const range = opts.range ?? 40;
  const cx = w / 2;
  const cy = h / 2 + 4;
  const R = Math.min(w, h) / 2 - 22;

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';

  if (!points || points.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.fillText('No data', cx, cy);
    return;
  }

  const maxDb = opts.maxDb ?? points.reduce((m, p) => Math.max(m, p.dbi), -999);
  const top = Math.ceil(maxDb / 5) * 5;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const r = (R * i) / 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const label = `${(top - range + (range * i) / 4).toFixed(0)}`;
    if (i < 4) ctx.fillText(label, cx + 2, cy - r + 11);
  }
  for (let a = 0; a < 360; a += 30) {
    const rad = ((a - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
    ctx.stroke();
  }
  ctx.fillStyle = MUTED;
  const label = (a) => opts.labels?.[a] ?? `${a}°`;
  ctx.textAlign = 'center';
  ctx.fillText(label(0), cx, cy - R - 6);
  ctx.fillText(label(180), cx, cy + R + 14);
  ctx.textAlign = 'right';
  ctx.fillText(label(270), cx - R - 5, cy + 4);
  ctx.textAlign = 'left';
  ctx.fillText(label(90), cx + R + 5, cy + 4);
  ctx.textAlign = 'center';

  const radiusOf = (dbi) => Math.max(0, Math.min(1, (dbi - (top - range)) / range)) * R;

  ctx.beginPath();
  points.forEach((p, i) => {
    const rad = ((p.angle - 90) * Math.PI) / 180;
    const r = radiusOf(p.dbi);
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(79,195,247,0.18)';
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = FG;
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(title, cx, 11);
}

/** SWR versus frequency. */
export function drawSweep(canvas, data, opts = {}) {
  const { ctx, w, h } = prepare(canvas);
  const pad = { l: 34, r: 10, t: 16, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  if (!data || data.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    ctx.fillText(opts.placeholder ?? 'Run a frequency sweep to see SWR', w / 2, h / 2);
    return;
  }

  const valid = data.filter((d) => Number.isFinite(d.swr));
  const f0 = data[0].frequencyMHz;
  const f1 = data[data.length - 1].frequencyMHz;
  const sMax = Math.max(3, Math.min(10, Math.ceil(Math.max(...valid.map((d) => d.swr)))));
  const X = (f) => pad.l + ((f - f0) / (f1 - f0 || 1)) * iw;
  const Y = (s) => pad.t + ih - ((Math.min(s, sMax) - 1) / (sMax - 1)) * ih;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let s = 1; s <= sMax; s += Math.max(1, Math.round((sMax - 1) / 4))) {
    const y = Y(s);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(`${s}`, pad.l - 5, y + 3);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const f = f0 + ((f1 - f0) * i) / 4;
    const x = X(f);
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + ih);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(f.toFixed(f1 - f0 < 10 ? 2 : 1), x, h - 7);
  }
  ctx.textAlign = 'center';

  // SWR = 2 reference line
  if (sMax >= 2) {
    ctx.strokeStyle = 'rgba(227,195,58,0.5)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(2));
    ctx.lineTo(w - pad.r, Y(2));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Amateur band edges
  if (opts.band) {
    ctx.fillStyle = 'rgba(39,192,138,0.10)';
    const xa = Math.max(pad.l, X(opts.band.start));
    const xb = Math.min(w - pad.r, X(opts.band.stop));
    if (xb > xa) {
      ctx.fillRect(xa, pad.t, xb - xa, ih);
      ctx.strokeStyle = 'rgba(39,192,138,0.6)';
      ctx.beginPath();
      ctx.moveTo(xa, pad.t);
      ctx.lineTo(xa, pad.t + ih);
      ctx.moveTo(xb, pad.t);
      ctx.lineTo(xb, pad.t + ih);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (const d of data) {
    if (!Number.isFinite(d.swr)) {
      started = false;
      continue;
    }
    const x = X(d.frequencyMHz);
    const y = Y(d.swr);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (Number.isFinite(opts.markerMHz)) {
    const x = X(opts.markerMHz);
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + ih);
    ctx.stroke();
  }

  const best = valid.reduce((a, b) => (b.swr < a.swr ? b : a), valid[0]);
  ctx.fillStyle = FG;
  ctx.textAlign = 'left';
  ctx.fillText(`min SWR ${best.swr.toFixed(2)} @ ${best.frequencyMHz.toFixed(3)} MHz`, pad.l, 11);
}
