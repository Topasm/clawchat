import { describe, expect, it } from 'vitest';
import { detectPathKind } from '../TaskPaths';

describe('detectPathKind', () => {
  it('tells a URL, a vault note and a folder apart by their shape', () => {
    expect(detectPathKind('https://example.com/hw3')).toBe('url');
    expect(detectPathKind('www.example.com')).toBe('url');
    expect(detectPathKind('~/postech/GPU_Computing/hw3')).toBe('device');
    expect(detectPathKind('/Users/me/hw3.md')).toBe('device');
    expect(detectPathKind('C:\\Users\\me\\hw3')).toBe('device');
    expect(detectPathKind('01_Projects/GPU_Computing/hw3.md')).toBe('vault');
  });
});
