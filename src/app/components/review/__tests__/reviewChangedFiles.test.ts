import { describe, expect, it } from 'vitest';
import type { ReviewItemResponse } from '../../../types/api';
import { reviewChangedFiles } from '../ReviewItemCard';

const item = (metadata: Record<string, unknown>) => ({ metadata }) as unknown as ReviewItemResponse;

describe('reviewChangedFiles', () => {
  it('lists the files the executor recorded, with the full count', () => {
    expect(
      reviewChangedFiles(
        item({
          changed_files: [
            { path: 'fig/fig1_latency.png', status: 'added' },
            { path: 'report.md', status: 'modified' },
            { status: 'added' },
          ],
          changed_files_count: 23,
        }),
      ),
    ).toEqual({
      files: [
        { path: 'fig/fig1_latency.png', status: 'added' },
        { path: 'report.md', status: 'modified' },
      ],
      count: 23,
    });
  });

  it('knows nothing when the executor did not diff', () => {
    expect(reviewChangedFiles(item({}))).toBeNull();
  });
});
