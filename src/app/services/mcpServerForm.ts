/** Parsing helpers for the MCP server form. */

/** Split a command line into words, honoring single and double quotes. */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const character of line) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/**
 * Parse "KEY=value" (or "Key: value") lines into a record; blank lines and
 * lines without a separator are skipped.
 */
export function parsePairs(text: string, separator: '=' | ':'): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const index = line.indexOf(separator);
    if (!line || index <= 0) continue;
    pairs[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return pairs;
}
