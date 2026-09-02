import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mediaInfoFactory from 'mediainfo.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mp4', import.meta.url));

test('mediainfo.js parses the fixture: one AVC video + one AAC audio track', async () => {
  const size = (await stat(fixture)).size;
  const fh = await open(fixture, 'r');
  const mi = await mediaInfoFactory({ format: 'object' });
  try {
    const result = await mi.analyzeData(size, async (chunkSize, offset) => {
      const buf = new Uint8Array(chunkSize);
      const { bytesRead } = await fh.read(buf, 0, chunkSize, offset);
      return bytesRead === chunkSize ? buf : buf.subarray(0, bytesRead);
    });
    const tracks = result.media.track;
    const byType = (t) => tracks.filter((x) => x['@type'] === t);
    assert.equal(byType('General').length, 1);
    assert.equal(byType('Video').length, 1);
    assert.equal(byType('Audio').length, 1);
    assert.equal(byType('Video')[0].Format, 'AVC');
    assert.equal(byType('Audio')[0].Format, 'AAC');
    assert.equal(byType('Video')[0].Width, 320);
    assert.match(result.creatingLibrary.version, /^\d+\.\d+/);
  } finally {
    mi.close();
    await fh.close();
  }
});
