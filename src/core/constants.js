// Physical constants (SI units) used throughout the electromagnetic solver.
export const C0 = 299792458;
export const MU0 = 4e-7 * Math.PI;
export const EPS0 = 1 / (MU0 * C0 * C0);
export const ETA0 = Math.sqrt(MU0 / EPS0);

export const MATERIALS = {
  pec: { label: 'Perfect conductor', sigma: 0 },
  copper: { label: 'Copper', sigma: 5.8e7 },
  aluminium: { label: 'Aluminium', sigma: 3.5e7 },
  brass: { label: 'Brass', sigma: 1.5e7 },
  steel: { label: 'Steel', sigma: 1.45e6 },
  stainless: { label: 'Stainless steel', sigma: 1.1e6 },
};

// Amateur allocations in MHz, widest of the three ITU regions.
export const AMATEUR_BANDS = [
  { name: '2200 m', start: 0.1357, stop: 0.1378 },
  { name: '630 m', start: 0.472, stop: 0.479 },
  { name: '160 m', start: 1.8, stop: 2.0 },
  { name: '80 m', start: 3.5, stop: 4.0 },
  { name: '60 m', start: 5.3515, stop: 5.3665 },
  { name: '40 m', start: 7.0, stop: 7.3 },
  { name: '30 m', start: 10.1, stop: 10.15 },
  { name: '20 m', start: 14.0, stop: 14.35 },
  { name: '17 m', start: 18.068, stop: 18.168 },
  { name: '15 m', start: 21.0, stop: 21.45 },
  { name: '12 m', start: 24.89, stop: 24.99 },
  { name: '10 m', start: 28.0, stop: 29.7 },
  { name: '6 m', start: 50.0, stop: 54.0 },
  { name: '4 m', start: 70.0, stop: 70.5 },
  { name: '2 m', start: 144.0, stop: 148.0 },
  { name: '1.25 m', start: 222.0, stop: 225.0 },
  { name: '70 cm', start: 430.0, stop: 440.0 },
  { name: '33 cm', start: 902.0, stop: 928.0 },
  { name: '23 cm', start: 1240.0, stop: 1300.0 },
];

export function bandFor(frequencyMHz) {
  return AMATEUR_BANDS.find((b) => frequencyMHz >= b.start && frequencyMHz <= b.stop) ?? null;
}
