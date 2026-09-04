import { describe, expect, it } from 'vitest';
import { recommendAlerts } from '../server/domain/smart-alerts.js';

describe('recommendAlerts', () => {
  it('uses wider inward buffers for narrow ranges', () => {
    expect(recommendAlerts(90, 110).bufferRatio).toBe(0.2);
    expect(recommendAlerts(50, 150).bufferRatio).toBe(0.08);
  });

  it('keeps recommended lines inside the LP bounds', () => {
    const result = recommendAlerts(100, 200);
    expect(result.lower).toBeGreaterThan(100);
    expect(result.upper).toBeLessThan(200);
    expect(result.confirmations).toBe(3);
  });
});
