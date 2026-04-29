import { evaluateOnSite, FUEL_THRESHOLD_L, GPS_THRESHOLD_M } from './gapFillJob';

const last = (over: Partial<{ latitude: number | null; longitude: number | null; fuel_value_end: number | null }> = {}) => ({
  latitude: 56.84 as number | null,
  longitude: 60.61 as number | null,
  fuel_value_end: null as number | null,
  ...over,
});

const next = (over: Partial<{ latitude: number | null; longitude: number | null; fuel_value_begin: number | null }> = {}) => ({
  latitude: 56.84 as number | null,
  longitude: 60.61 as number | null,
  fuel_value_begin: null as number | null,
  ...over,
});

describe('evaluateOnSite', () => {
  it('returns onSite=false when both boundaries null', () => {
    expect(evaluateOnSite(null, null).onSite).toBe(false);
  });

  it('returns onSite=false when neither side has GPS', () => {
    const l = last({ latitude: null, longitude: null });
    const n = next({ latitude: null, longitude: null });
    expect(evaluateOnSite(l, n).onSite).toBe(false);
  });

  it('returns onSite=true when GPS close and no fuel data', () => {
    // Same spot, both sides
    const r = evaluateOnSite(last(), next());
    expect(r.onSite).toBe(true);
    expect(r.gpsOk).toBe(true);
    expect(r.hasFuelData).toBe(false);
  });

  it('returns onSite=false when GPS far apart', () => {
    // ~1.1km apart — exceeds 500m threshold
    const r = evaluateOnSite(last({ latitude: 56.840 }), next({ latitude: 56.850 }));
    expect(r.gpsOk).toBe(false);
    expect(r.onSite).toBe(false);
  });

  it('returns onSite=true when only one side has GPS', () => {
    // Missing last GPS, has next GPS → trust it, call on-site
    const r = evaluateOnSite(last({ latitude: null, longitude: null }), next());
    expect(r.onSite).toBe(true);
  });

  it('requires both GPS and fuel check when fuel data present — pass', () => {
    const r = evaluateOnSite(
      last({ fuel_value_end: 150 }),
      next({ fuel_value_begin: 155 }), // Δ=5L < 10L
    );
    expect(r.hasFuelData).toBe(true);
    expect(r.fuelOk).toBe(true);
    expect(r.onSite).toBe(true);
  });

  it('requires both GPS and fuel check when fuel data present — fuel fail blocks on-site', () => {
    const r = evaluateOnSite(
      last({ fuel_value_end: 150 }),
      next({ fuel_value_begin: 200 }), // Δ=50L >> 10L (refuel happened)
    );
    expect(r.gpsOk).toBe(true);
    expect(r.fuelOk).toBe(false);
    expect(r.onSite).toBe(false);
  });

  it('ignores fuel when only one side has fuel reading', () => {
    const r = evaluateOnSite(
      last({ fuel_value_end: 150 }),
      next({ fuel_value_begin: null }),
    );
    expect(r.hasFuelData).toBe(false);
    expect(r.onSite).toBe(true); // GPS alone is enough
  });

  it('uses documented thresholds', () => {
    expect(GPS_THRESHOLD_M).toBe(500);
    expect(FUEL_THRESHOLD_L).toBe(10);
  });
});
