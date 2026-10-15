import { describe, expect, it } from 'vitest';
import { compareVersions, findVersionMismatch } from '../serverVersion';

describe('compareVersions', () => {
  it('compares numerically rather than as text', () => {
    expect(compareVersions('1.4.30', '1.4.43')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.4.43', '1.4.43')).toBe(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
  });

  it('refuses versions it cannot read', () => {
    expect(compareVersions('unknown', '1.4.43')).toBeNull();
  });
});

describe('findVersionMismatch', () => {
  it('names an older Home behind a newer desktop app', () => {
    expect(findVersionMismatch('1.4.43', '1.4.30')).toEqual({
      appVersion: '1.4.43',
      serverVersion: '1.4.30',
      older: 'server',
    });
  });

  it('names an older app in front of a newer server', () => {
    expect(findVersionMismatch('1.4.30', '1.4.43')?.older).toBe('app');
  });

  it('stays quiet when both sides run the same release', () => {
    expect(findVersionMismatch('1.4.43', 'v1.4.43')).toBeNull();
  });

  it('does not guess when either version is missing or unnamed', () => {
    expect(findVersionMismatch('1.4.43', '')).toBeNull();
    expect(findVersionMismatch('1.4.43', 'unknown')).toBeNull();
    expect(findVersionMismatch(undefined, '1.4.30')).toBeNull();
    expect(findVersionMismatch('dev', '1.4.30')).toBeNull();
  });
});
