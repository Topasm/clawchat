import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import { loadCompressedJson } from '../localeCatalog';

describe('compressed catalog transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  function respond(bytes: Uint8Array, status = 200) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status === 200,
        status,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
    );
  }

  it('decodes gzip bytes from native asset serving', async () => {
    respond(gzipSync(strToU8('{"title":"작업"}')));
    await expect(loadCompressedJson('/catalog.gz')).resolves.toEqual({ title: '작업' });
  });

  it('accepts JSON already decompressed by fetch', async () => {
    respond(strToU8('{"title":"작업"}'));
    await expect(loadCompressedJson('/catalog.gz')).resolves.toEqual({ title: '작업' });
  });

  it('rejects unsuccessful responses', async () => {
    respond(new Uint8Array(), 404);
    await expect(loadCompressedJson('/catalog.gz')).rejects.toThrow('(404)');
  });

  it('does not hide corrupt gzip or invalid JSON', async () => {
    respond(new Uint8Array([0x1f, 0x8b, 0]));
    await expect(loadCompressedJson('/catalog.gz')).rejects.toThrow();
    respond(strToU8('<html>Not a catalog</html>'));
    await expect(loadCompressedJson('/catalog.gz')).rejects.toThrow();
  });
});
