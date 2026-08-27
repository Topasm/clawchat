import { describe, expect, it } from 'vitest';
import { getRelationshipMutationErrorMessage } from '../RelationshipsSection';

describe('relationship mutation errors', () => {
  it('surfaces normalized relationship validation messages', () => {
    expect(
      getRelationshipMutationErrorMessage(
        {
          response: {
            status: 400,
            data: { error: { code: 'cycle', message: 'Dependency would create a cycle' } },
          },
        },
        'fallback',
      ),
    ).toBe('Dependency would create a cycle');

    expect(
      getRelationshipMutationErrorMessage(
        { response: { status: 409, data: { detail: 'Relationship already exists' } } },
        'fallback',
      ),
    ).toBe('Relationship already exists');

    expect(
      getRelationshipMutationErrorMessage(
        {
          response: {
            status: 422,
            data: { detail: [{ msg: 'Source task is required' }, { msg: 'Invalid type' }] },
          },
        },
        'fallback',
      ),
    ).toBe('Source task is required; Invalid type');
  });

  it('uses a safe fallback for unrelated or malformed errors', () => {
    expect(
      getRelationshipMutationErrorMessage(
        { response: { status: 500, data: { detail: 'database path' } } },
        'Failed to add dependency',
      ),
    ).toBe('Failed to add dependency');
  });
});
