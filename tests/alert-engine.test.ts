import { describe, expect, it } from 'vitest';
import { evaluateAlert } from '../server/domain/alert-engine.js';

describe('evaluateAlert', () => {
  it('alerts once on the same side and rearms inside the channel', () => {
    const first = evaluateAlert(89, 90, 110, { armed: true, lastBoundary: null });
    expect(first.event).toBe('lower');
    expect(first.state.armed).toBe(false);

    const repeated = evaluateAlert(88, 90, 110, first.state);
    expect(repeated.event).toBeNull();

    const safe = evaluateAlert(100, 90, 110, repeated.state);
    expect(safe.state).toEqual({ armed: true, lastBoundary: null });

    expect(evaluateAlert(111, 90, 110, safe.state).event).toBe('upper');
  });
});
