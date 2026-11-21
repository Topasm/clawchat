import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../unifiedDiff';

describe('parseUnifiedDiff', () => {
  it('splits a patch into files with counted lines', () => {
    const patch = [
      '--- a/calc.py',
      '+++ b/calc.py',
      '@@ -1,2 +1,2 @@',
      ' def add(a, b):',
      '-    return a - b',
      '+    return a + b',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1,2 @@',
      ' # spike',
      '+More',
    ].join('\n');
    const files = parseUnifiedDiff(patch);
    expect(files.map((file) => [file.path, file.additions, file.deletions])).toEqual([
      ['calc.py', 1, 1],
      ['README.md', 1, 0],
    ]);
    expect(files[0].lines.map((line) => line.kind)).toEqual(['hunk', 'context', 'del', 'add']);
    expect(files[0].lines[3].text).toBe('    return a + b');
  });

  it('names a new file by its new path and keeps git headers out', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        'index 0000000..e69de29',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1 @@',
        '+hello',
      ].join('\n'),
    );
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('new.txt');
    expect(files[0].lines.map((line) => line.kind)).toEqual(['hunk', 'add']);
  });

  it('keeps binary and truncation notices as notes', () => {
    const files = parseUnifiedDiff(
      [
        'Binary file logo.png changed',
        '--- a/a.py',
        '+++ b/a.py',
        '@@ -1 +1 @@',
        '-x',
        '+y',
        '…(patch truncated)',
      ].join('\n'),
    );
    expect(files[0]).toMatchObject({ path: 'logo.png', lines: [{ kind: 'note' }] });
    expect(files[1].lines.at(-1)).toEqual({ kind: 'note', text: '…(patch truncated)' });
  });

  it('returns nothing for an empty patch', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
