import { describe, expect, it } from 'vitest';
import { riskLabel } from '../ReviewItemCard';

describe('riskLabel', () => {
  it('names a result that only looked things up apart from low risk', () => {
    expect(riskLabel('read_only_tools')).toBe('Read-only tools');
    expect(riskLabel('read_only_tools')).not.toBe(riskLabel('low'));
  });

  it('keeps the other levels as they were', () => {
    expect(riskLabel('low')).toBe('Low risk');
    expect(riskLabel('medium')).toBe('Worth a close look');
    expect(riskLabel('high')).toBe('High risk');
  });
});
