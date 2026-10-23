import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Frames for a stitched GIF: each call saves one screenshot and appends a
 * "file / duration" pair to the story's frames.txt (ffmpeg's concat demuxer
 * input, see scripts/readme-gifs.mjs).
 */
export class Story {
  private index = 0;
  readonly dir: string;
  private last = '';

  constructor(root: string, readonly name: string) {
    this.dir = path.join(root, '.frames', name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }

  async frame(page: Page, label: string, holdSeconds: number) {
    this.index += 1;
    const file = path.join(this.dir, `${String(this.index).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file });
    appendFileSync(path.join(this.dir, 'frames.txt'), `file '${file}'\nduration ${holdSeconds}\n`);
    this.last = file;
  }

  /** The concat demuxer drops the last duration unless the last file is listed again. */
  finish() {
    if (this.last) appendFileSync(path.join(this.dir, 'frames.txt'), `file '${this.last}'\n`);
  }
}
