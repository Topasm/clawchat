/** One line of a unified diff as a reviewer reads it. */
export interface DiffLine {
  kind: 'add' | 'del' | 'context' | 'hunk' | 'note';
  text: string;
}

/** The changes to one file. */
export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

const HEADER_PREFIXES = [
  'diff --git ',
  'index ',
  'new file mode',
  'deleted file mode',
  'similarity ',
];

function pathFrom(header: string): string {
  const raw = header.slice(4).trim().split('\t')[0];
  return raw === '/dev/null' ? '' : raw.replace(/^[ab]\//, '');
}

/**
 * Split a patch (as Orca and OpenCode runs record it) into files.
 *
 * Tolerant by design: anything before the first file header, a binary-file
 * notice or a truncation marker becomes a `note` line rather than an error,
 * because the reviewer should still see what was recorded.
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldPath = pathFrom(line);
      const newPath = pathFrom(lines[i + 1]);
      current = { path: newPath || oldPath, additions: 0, deletions: 0, lines: [] };
      files.push(current);
      i += 1;
      continue;
    }
    if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
    const binary = /^Binary files? (.+?) (?:and .+ )?(?:differ|changed)$/.exec(line);
    if (binary) {
      current = {
        path: binary[1].replace(/^[ab]\//, ''),
        additions: 0,
        deletions: 0,
        lines: [{ kind: 'note', text: line }],
      };
      files.push(current);
      continue;
    }
    if (!current) {
      if (line.trim()) {
        current = { path: '', additions: 0, deletions: 0, lines: [] };
        files.push(current);
      } else {
        continue;
      }
    }
    if (line.startsWith('@@')) {
      current.lines.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      current.additions += 1;
      current.lines.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      current.deletions += 1;
      current.lines.push({ kind: 'del', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      current.lines.push({ kind: 'context', text: line.slice(1) });
    } else if (line.startsWith('\\') || line.trim()) {
      current.lines.push({ kind: 'note', text: line });
    }
  }
  return files.filter((file) => file.lines.length > 0 || file.path);
}
