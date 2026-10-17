// Runs the method-of-moments solver off the main thread.
import { analyze, sweep } from '../core/analysis.js';

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data;
  try {
    if (type === 'analyze') {
      const t0 = performance.now();
      const result = analyze(payload.model, payload.options);
      result.solveTimeMs = performance.now() - t0;
      self.postMessage({ id, type: 'analyze:done', result });
    } else if (type === 'sweep') {
      const { model, startMHz, stopMHz, points } = payload;
      const data = sweep(model, startMHz, stopMHz, points, (p) => {
        self.postMessage({ id, type: 'sweep:progress', progress: p });
      });
      self.postMessage({ id, type: 'sweep:done', data });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message ?? String(err) });
  }
};
