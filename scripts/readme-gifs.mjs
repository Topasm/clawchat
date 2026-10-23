#!/usr/bin/env node
/**
 * Stitch the walkthrough frames recorded by e2e/readme/readme.spec.ts into
 * GIFs under docs/media/. One GIF per story folder in e2e/readme/.frames/.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framesRoot = path.join(root, 'e2e', 'readme', '.frames');
const mediaDir = path.join(root, 'docs', 'media');
const MAX_BYTES = 3 * 1024 * 1024;

if (!existsSync(framesRoot)) {
  console.error(`No frames in ${framesRoot}. Run \`npm run readme:media:shots\` first.`);
  process.exit(1);
}

const stories = readdirSync(framesRoot).filter((name) => existsSync(path.join(framesRoot, name, 'frames.txt')));
if (stories.length === 0) {
  console.error('No story has a frames.txt.');
  process.exit(1);
}

for (const story of stories) {
  const list = path.join(framesRoot, story, 'frames.txt');
  const out = path.join(mediaDir, `${story}.gif`);
  // One pass: a palette from the frame differences, then dithered playback
  // that re-encodes only the changed rectangle between held frames.
  const filter =
    'scale=1200:-2:flags=lanczos,split[a][b];' +
    '[a]palettegen=max_colors=128:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', filter, '-loop', '0', out],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`ffmpeg failed for ${story}`);
    process.exit(result.status ?? 1);
  }
  const size = statSync(out).size;
  console.log(`${path.relative(root, out)}: ${(size / 1024).toFixed(0)} KB`);
  if (size > MAX_BYTES) {
    console.error(`${story}.gif is over 3 MB; lower max_colors to 96 or scale to 1000 in scripts/readme-gifs.mjs.`);
    process.exit(1);
  }
}
