import { describe, expect, it } from 'vitest';
import { extractCanonicalDoc } from '../canonicalDoc';

describe('extractCanonicalDoc', () => {
  it.each([
    ['/home/research/srp/E65.md', '/home/research/srp/E65.md'],
    ['~/Desktop/research_graph/E65.md', '~/Desktop/research_graph/E65.md'],
    ['obsidian://open?vault=research&file=E65', 'obsidian://open?vault=research&file=E65'],
  ])('extracts a supported first-line target from %s', (description, expected) => {
    expect(extractCanonicalDoc(`${description}\nMore project context`)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['Canonical document: /home/research/E65.md'],
    ['notes/E65.md'],
    ['Project context\n/home/research/E65.md'],
    ['/home/research/E65.txt'],
    ['https://example.com/E65.md'],
  ])('rejects unsupported or non-first-line descriptions', (description) => {
    expect(extractCanonicalDoc(description)).toBeNull();
  });
});
