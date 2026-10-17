// Renders the match badge, the numeric cards and the model-check list.

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Azimuth is measured from +X (east); hams read compass bearings from north. */
export function bearingFromPhi(phiDeg) {
  return ((90 - phiDeg) % 360 + 360) % 360;
}

export function compassPoint(bearing) {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

function card(label, value, tip = '') {
  return `<div class="metric glass"${tip ? ` title="${tip}"` : ''}>
    <span>${label}</span>
    <strong>${value}</strong>
  </div>`;
}

function swrClass(swr) {
  if (swr <= 1.5) return 'good';
  if (swr <= 3) return 'warn';
  return 'bad';
}

/** Match verdict plus the three power figures that go with it. */
export function renderSummary(el, result) {
  if (!result) {
    el.hidden = true;
    return;
  }
  const { swr, z0, gamma, returnLoss, efficiency } = result;
  const kind = swr <= 2 ? 'good' : swr <= 3 ? 'warn' : 'bad';
  const headline = swr <= 1.5 ? 'Great match' : swr <= 2 ? 'Good match' : swr <= 3 ? 'Workable match' : 'Poor match';

  const effPct = efficiency * 100;
  const effCls = effPct >= 90 ? 'good' : effPct >= 70 ? 'warn' : 'bad';
  el.className = `glass ${kind}`;
  el.innerHTML = `<p class="verdict">${headline}</p>
    <div class="stats">
      <div class="stat ${swrClass(swr)}" title="Standing wave ratio on your ${z0} Ω line. Under 2:1 keeps most transceivers happy.">
        <span>SWR</span><strong>${swr.toFixed(2)}:1</strong>
      </div>
      <div class="stat" title="Transmit power that bounces back from the feedpoint · ${returnLoss.toFixed(1)} dB return loss">
        <span>Reflected</span><strong>${(gamma * gamma * 100).toFixed(1)} %</strong>
      </div>
      <div class="stat ${effCls}" title="Share of transmit power that actually leaves the antenna.">
        <span>Efficiency</span><strong>${effPct.toFixed(1)} %</strong>
      </div>
    </div>`;
  el.hidden = false;
}

export function renderMetrics(el, result) {
  if (!result) {
    el.innerHTML = '<p class="empty">Nothing calculated yet.</p>';
    return;
  }
  const { zin, gainDbi } = result;
  const elev = 90 - result.maxTheta;

  el.innerHTML = [
    card('Feedpoint impedance', `${zin.r.toFixed(1)} ${zin.x >= 0 ? '+' : '−'} j${Math.abs(zin.x).toFixed(1)} Ω`,
      'What your feed line sees. The j term is reactance; zero means resonant.'),
    card('Peak gain', `${gainDbi.toFixed(2)} dBi`,
      'dBi compares against an ideal point radiator. Over ground the figure already includes the reflection gain.'),
    card('Take-off angle', `${elev.toFixed(0)}°`,
      'Elevation of the strongest lobe. Low angles reach far, high angles go local.'),
  ].join('');
}

export function renderWarnings(panel, list, warnings) {
  const items = warnings ?? [];
  if (items.length === 0) {
    panel.hidden = true;
    list.textContent = '';
    return;
  }
  panel.hidden = false;
  list.innerHTML = items.map((w) => `<li>${w}</li>`).join('');
}
