// Application wiring: model state, solver worker, 3D view, charts and panels.

import { keepMeshDensity, modelFromJson, modelToJson, rotateModel, wireLength } from './core/model.js';
import { bandFor } from './core/constants.js';
import { PRESETS, presetById } from './core/presets.js';
import { Sidebar } from './ui/panel.js';
import { Viewer3D } from './ui/viewer3d.js';
import { drawPolar, drawSweep } from './ui/charts.js';
import { renderMetrics, renderSummary, renderWarnings, bearingFromPhi, compassPoint } from './ui/results.js';

const $ = (id) => document.getElementById(id);

const refs = {
  presetSelect: $('presetSelect'),
  loadPresetBtn: $('loadPresetBtn'),
  freq: $('freq'),
  bandSelect: $('bandSelect'),
  lambdaOut: $('lambdaOut'),
  bandOut: $('bandOut'),
  groundSelect: $('groundSelect'),
  groundHint: $('groundHint'),
  heightOffset: $('heightOffset'),
  heightOut: $('heightOut'),
  z0: $('z0'),
  z0Preset: $('z0Preset'),
  materialSelect: $('materialSelect'),
  wireTbody: $('wireTbody'),
  addWireBtn: $('addWireBtn'),
  autoSegBtn: $('autoSegBtn'),
  advancedGeom: $('advancedGeom'),
  feedWire: $('feedWire'),
  feedFraction: $('feedFraction'),
  feedFractionOut: $('feedFractionOut'),
};

const statusEl = $('status');
const metricsEl = $('metrics');
const summaryEl = $('summaryBox');
const warningsPanel = $('warningsPanel');
const warningsList = $('warnings');
const azCanvas = $('azCanvas');
const elCanvas = $('elCanvas');
const sweepCanvas = $('sweepCanvas');
const sweepProgress = $('sweepProgress');
const modelNameEl = $('modelName');

let model = PRESETS[0].create();
let result = null;
let sweepData = null;
let requestId = 0;
let pendingAnalysis = 0;
let debounceTimer = 0;

const worker = new Worker(new URL('./workers/solver.worker.js', import.meta.url), { type: 'module' });

const viewer = new Viewer3D($('viewport'), {
  onHandleDrag(wireId, end, pos, final) {
    const wire = model.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const before = wireLength(wire);
    const target = end === 0 ? wire.p1 : wire.p2;
    target[0] = pos[0];
    target[1] = pos[1];
    target[2] = pos[2] - (model.heightOffset ?? 0);
    if (final) keepMeshDensity(wire, before);
    sidebar.syncValues();
    if (!final) {
      if (viewer.result) viewer.clearResult();
      viewer.refreshWires();
    } else {
      viewer.setModel(model);
      scheduleAnalysis();
    }
  },
});

const sidebar = new Sidebar(refs, {
  onChange() {
    viewer.setModel(model);
    scheduleAnalysis();
  },
});

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function scheduleAnalysis() {
  if (!$('autoSolve').checked) {
    setStatus('Model changed — press Analyse');
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(runAnalysis, 300);
}

function runAnalysis() {
  clearTimeout(debounceTimer);
  pendingAnalysis = ++requestId;
  setStatus('Solving…', 'busy');
  worker.postMessage({ id: pendingAnalysis, type: 'analyze', payload: { model, options: { stepDeg: 5 } } });
}

function runSweep() {
  const span = Math.max(0.1, Number($('sweepSpan').value)) / 100;
  const f = model.frequencyMHz;
  startSweep(f * (1 - span), f * (1 + span));
}

function runBandSweep() {
  const band = bandFor(model.frequencyMHz);
  if (!band) {
    setStatus(`${model.frequencyMHz} MHz is not in an amateur band`, 'error');
    return;
  }
  const pad = (band.stop - band.start) * 0.1;
  startSweep(band.start - pad, band.stop + pad);
}

function startSweep(startMHz, stopMHz) {
  const points = Math.max(5, Math.min(81, Math.round(Number($('sweepPoints').value))));
  sweepProgress.hidden = false;
  sweepProgress.firstElementChild.style.width = '0%';
  setStatus('Sweeping…', 'busy');
  worker.postMessage({ id: ++requestId, type: 'sweep', payload: { model, startMHz, stopMHz, points } });
}

function sweepOptions() {
  const band = bandFor(model.frequencyMHz);
  return { markerMHz: model.frequencyMHz, band };
}

worker.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'analyze:done') {
    if (msg.id !== pendingAnalysis) return;
    result = msg.result;
    viewer.setResult(result);
    renderSummary(summaryEl, result);
    renderMetrics(metricsEl, result);
    renderWarnings(warningsPanel, warningsList, result.warnings);
    drawCuts();
    drawSweep(sweepCanvas, sweepData, sweepOptions());
    setStatus(`Solved ${result.basisCount} unknowns in ${result.solveTimeMs.toFixed(0)} ms`);
  } else if (msg.type === 'sweep:progress') {
    sweepProgress.firstElementChild.style.width = `${(msg.progress * 100).toFixed(0)}%`;
  } else if (msg.type === 'sweep:done') {
    sweepData = msg.data;
    sweepProgress.hidden = true;
    drawSweep(sweepCanvas, sweepData, sweepOptions());
    setStatus('Sweep complete');
  } else if (msg.type === 'error') {
    sweepProgress.hidden = true;
    setStatus(msg.message, 'error');
    renderWarnings(warningsPanel, warningsList, [msg.message]);
  }
};

worker.onerror = (err) => setStatus(`Solver failed: ${err.message}`, 'error');

function drawCuts() {
  if (!result) return;
  const range = Number($('dbRange').value);
  drawPolar(azCanvas, result.cuts.azimuth.map((p) => ({ angle: bearingFromPhi(p.angle), dbi: p.dbi })), {
    title: `Looking down · ${(90 - result.cuts.azimuthThetaDeg).toFixed(0)}° up`,
    range,
    maxDb: result.gainDbi,
    labels: { 0: 'N', 90: 'E', 180: 'S', 270: 'W' },
  });
  const elevBearing = bearingFromPhi(result.cuts.elevationPhiDeg);
  drawPolar(elCanvas, result.cuts.elevation, {
    title: `Side view · towards ${compassPoint(elevBearing)}`,
    range,
    maxDb: result.gainDbi,
    labels: { 0: 'up', 90: compassPoint(elevBearing), 180: 'down', 270: compassPoint((elevBearing + 180) % 360) },
  });
}

function loadModel(next, { fit = true } = {}) {
  model = next;
  result = null;
  sweepData = null;
  modelNameEl.textContent = model.name;
  sidebar.render(model, { structural: true });
  viewer.setModel(model, { fit });
  viewer.clearResult();
  renderSummary(summaryEl, null);
  renderMetrics(metricsEl, null);
  renderWarnings(warningsPanel, warningsList, []);
  drawPolar(azCanvas, null);
  drawPolar(elCanvas, null);
  drawSweep(sweepCanvas, null);
  runAnalysis();
}

// ---- toolbar & file actions -------------------------------------------------

$('solveBtn').addEventListener('click', runAnalysis);
$('runSweep').addEventListener('click', runSweep);
$('runBandSweep').addEventListener('click', runBandSweep);
$('resetView').addEventListener('click', () => viewer.fitView());

for (const btn of document.querySelectorAll('#rotateTools button')) {
  btn.addEventListener('click', () => {
    rotateModel(model, btn.dataset.axis);
    sidebar.syncValues();
    viewer.setModel(model);
    scheduleAnalysis();
  });
}

const appEl = $('app');
const toggleLeftBtn = $('toggleLeft');
toggleLeftBtn.addEventListener('click', () => {
  const hidden = !appEl.classList.contains('hide-left');
  appEl.classList.toggle('hide-left', hidden);
  toggleLeftBtn.textContent = hidden ? '›' : '‹';
  toggleLeftBtn.setAttribute('aria-expanded', String(!hidden));
  toggleLeftBtn.title = `${hidden ? 'Show' : 'Hide'} the design panel`;
  // Canvases have no size while hidden, so redraw once the layout has settled.
  requestAnimationFrame(() => {
    viewer.resize();
    drawCuts();
    drawSweep(sweepCanvas, sweepData, sweepOptions());
  });
});

$('loadPresetBtn').addEventListener('click', () => {
  const preset = presetById(refs.presetSelect.value);
  if (preset) loadModel(preset.create());
});

for (const [id, key] of [['togglePattern', 'showPattern'], ['toggleWires', 'showWires'], ['toggleCurrent', 'showCurrent']]) {
  $(id).addEventListener('change', (e) => viewer.setOptions({ [key]: e.target.checked }));
}
$('scaleSelect').addEventListener('change', (e) => viewer.setOptions({ patternScale: e.target.value }));
$('dbRange').addEventListener('input', (e) => {
  viewer.setOptions({ dbRange: Number(e.target.value) });
  drawCuts();
});
$('opacity').addEventListener('input', (e) => viewer.setOptions({ patternOpacity: Number(e.target.value) }));

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([modelToJson(model)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${model.name.replace(/[^\w.-]+/g, '_') || 'antenna'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    loadModel(modelFromJson(await file.text()));
  } catch (err) {
    setStatus(`Could not open file: ${err.message}`, 'error');
  }
  e.target.value = '';
});

window.addEventListener('resize', () => {
  drawCuts();
  drawSweep(sweepCanvas, sweepData, sweepOptions());
});

// ---- boot -------------------------------------------------------------------

sidebar.render(model, { structural: true });
viewer.setModel(model, { fit: true });
modelNameEl.textContent = model.name;
renderSummary(summaryEl, null);
renderMetrics(metricsEl, null);
drawPolar(azCanvas, null);
drawPolar(elCanvas, null);
drawSweep(sweepCanvas, null);
runAnalysis();
