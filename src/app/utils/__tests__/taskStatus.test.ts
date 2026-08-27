import { describe, expect, it } from 'vitest';
import { getTaskStatusLabel, isTerminalTaskStatus } from '../taskStatus';

describe('task status helpers', () => {
  it('treats only completed and cancelled tasks as terminal', () => {
    expect(isTerminalTaskStatus('pending')).toBe(false);
    expect(isTerminalTaskStatus('in_progress')).toBe(false);
    expect(isTerminalTaskStatus('completed')).toBe(true);
    expect(isTerminalTaskStatus('cancelled')).toBe(true);
  });

  it('provides a label for every canonical status', () => {
    expect(getTaskStatusLabel('pending')).toBe('Todo');
    expect(getTaskStatusLabel('in_progress')).toBe('In Progress');
    expect(getTaskStatusLabel('completed')).toBe('Done');
    expect(getTaskStatusLabel('cancelled')).toBe('Cancelled');
  });
});
