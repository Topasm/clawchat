import { describe, expect, it } from 'vitest';
import { getTaskStatusLabel, isTerminalTaskStatus } from '../taskStatus';

describe('task status helpers', () => {
  it('treats only completed and cancelled tasks as terminal', () => {
    expect(isTerminalTaskStatus('pending')).toBe(false);
    expect(isTerminalTaskStatus('in_progress')).toBe(false);
    expect(isTerminalTaskStatus('completed')).toBe(true);
    expect(isTerminalTaskStatus('cancelled')).toBe(true);
  });

  it('uses one user-facing label for both active wire statuses', () => {
    expect(getTaskStatusLabel('pending')).toBe('Active');
    expect(getTaskStatusLabel('in_progress')).toBe('Active');
    expect(getTaskStatusLabel('completed')).toBe('Done');
    expect(getTaskStatusLabel('cancelled')).toBe('Cancelled');
  });
});
