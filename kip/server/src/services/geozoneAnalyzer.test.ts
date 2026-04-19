import { fillTrackGaps, haversineMeters, type TrackPoint } from './geozoneAnalyzer';

describe('haversineMeters', () => {
  it('returns ~0 for the same point', () => {
    expect(haversineMeters(56.84, 60.61, 56.84, 60.61)).toBeLessThan(0.1);
  });

  it('returns ~111km for one degree of latitude', () => {
    const d = haversineMeters(56, 60, 57, 60);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a = haversineMeters(56.84, 60.61, 56.85, 60.62);
    const b = haversineMeters(56.85, 60.62, 56.84, 60.61);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});

describe('fillTrackGaps', () => {
  const mkPoint = (lat: number, lon: number, t: string): TrackPoint => ({
    lat, lon, timestamp: t,
  });

  it('returns empty track unchanged', () => {
    expect(fillTrackGaps([])).toEqual([]);
  });

  it('returns single-point track unchanged', () => {
    const track = [mkPoint(56.84, 60.61, '01.04.2026 08:00:00')];
    expect(fillTrackGaps(track)).toEqual(track);
  });

  it('does not insert synthetic points when gap GPS > 500m (vehicle moved)', () => {
    // ~1.1km apart — 0.01° latitude
    const track = [
      mkPoint(56.840, 60.610, '01.04.2026 08:00:00'),
      mkPoint(56.850, 60.610, '01.04.2026 10:00:00'),
    ];
    const filled = fillTrackGaps(track);
    expect(filled).toHaveLength(2);
  });

  it('inserts synthetic points when gap GPS < 500m (vehicle stayed)', () => {
    // Same position, 2h gap → expect 5 synthetic points at 20-min step (20, 40, 60, 80, 100 min)
    const track = [
      mkPoint(56.8400, 60.6100, '01.04.2026 08:00:00'),
      mkPoint(56.8401, 60.6101, '01.04.2026 10:00:00'),
    ];
    const filled = fillTrackGaps(track);
    // Original 2 + 5 synthetic = 7 (at 08:20, 08:40, 09:00, 09:20, 09:40)
    expect(filled.length).toBe(7);
    // Synthetic points carry prev coords
    expect(filled[1].lat).toBeCloseTo(56.8400);
    expect(filled[1].lon).toBeCloseTo(60.6100);
  });

  it('preserves input points verbatim', () => {
    const track = [
      mkPoint(56.84, 60.61, '01.04.2026 08:00:00'),
      mkPoint(56.85, 60.62, '01.04.2026 10:00:00'),
    ];
    const filled = fillTrackGaps(track);
    expect(filled[0]).toEqual(track[0]);
    expect(filled[filled.length - 1]).toEqual(track[track.length - 1]);
  });

  it('skips synthetic insertion if timestamps fail to parse', () => {
    const track = [
      mkPoint(56.84, 60.61, 'not-a-date'),
      mkPoint(56.84, 60.61, 'also-bad'),
    ];
    const filled = fillTrackGaps(track);
    // GPS < 500m but timestamps unparsable → no synthetic points inserted
    expect(filled).toHaveLength(2);
  });
});
