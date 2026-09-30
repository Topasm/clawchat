import { describe, expect, it } from 'vitest';
import { parsePairs, splitCommandLine } from '../mcpServerForm';

describe('mcpServerForm', () => {
  it('splits a command line, keeping quoted words together', () => {
    expect(
      splitCommandLine('npx -y @modelcontextprotocol/server-filesystem "/home/me/My Notes"'),
    ).toEqual(['npx', '-y', '@modelcontextprotocol/server-filesystem', '/home/me/My Notes']);
    expect(splitCommandLine("  uvx  mcp-server-time --local-timezone 'Asia/Seoul' ")).toEqual([
      'uvx',
      'mcp-server-time',
      '--local-timezone',
      'Asia/Seoul',
    ]);
    expect(splitCommandLine('run ""')).toEqual(['run', '']);
  });

  it('reads environment variables and headers one per line', () => {
    expect(parsePairs('API_KEY=abc=def\n\nnot a pair\nREGION = eu', '=')).toEqual({
      API_KEY: 'abc=def',
      REGION: 'eu',
    });
    expect(parsePairs('Authorization: Bearer x:y', ':')).toEqual({
      Authorization: 'Bearer x:y',
    });
  });
});
