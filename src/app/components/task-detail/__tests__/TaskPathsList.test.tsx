import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskPaths from '../TaskPaths';

const mocks = vi.hoisted(() => ({
  deleteAttachment: vi.fn(async () => undefined),
  upload: vi.fn(async () => ({})),
  addPath: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useTodoPathsQuery: () => ({
    data: [
      {
        id: 'path-1',
        kind: 'device',
        path: '~/postech/GPU_Computing/hw3',
        label: null,
        host_id: 'host-1',
        host_label: 'Lab Mac',
        inherited: true,
      },
    ],
  }),
  useAttachmentsQuery: () => ({
    data: [
      {
        id: 'att-1',
        filename: 'notice.png',
        content_type: 'image/png',
        size_bytes: 2048,
        url: '/api/attachments/att-1/download',
        created_at: '2026-10-16T00:00:00Z',
      },
    ],
  }),
  useAddTodoPath: () => ({ mutate: mocks.addPath }),
  useDeleteTodoPath: () => ({ mutate: vi.fn() }),
  useDeleteAttachment: () => ({ mutateAsync: mocks.deleteAttachment }),
  useUploadAttachment: () => ({ mutateAsync: mocks.upload }),
}));
vi.mock('../../../hooks/usePlatform', () => ({ default: () => ({ isDesktop: false }) }));
vi.mock('../../../stores/useWorkerStore', () => ({
  useWorkerStore: (selector: (s: { hostId: string | null }) => unknown) =>
    selector({ hostId: null }),
}));
vi.mock('../../../stores/useAuthStore', () => ({
  useAuthStore: (selector: (s: { serverUrl: string }) => unknown) =>
    selector({ serverUrl: 'http://home:8000' }),
}));
vi.mock('../../../stores/useToastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
    { getState: () => ({ addToast: vi.fn() }) },
  ),
}));

describe('TaskPaths as the one resources list', () => {
  beforeEach(() => {
    mocks.deleteAttachment.mockClear();
    mocks.upload.mockClear();
  });

  it('lists uploaded files next to paths under one heading', () => {
    render(<TaskPaths taskId="task-1" />);
    expect(screen.getByRole('region', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByText('~/postech/GPU_Computing/hw3')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('notice.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Drop files here or click to browse')).toBeInTheDocument();
  });

  it('removes an uploaded file from the same row', async () => {
    render(<TaskPaths taskId="task-1" />);
    // The inherited path has no remove button; the file's is the only one.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mocks.deleteAttachment).toHaveBeenCalledWith({ id: 'att-1', ownerId: 'task-1' });
  });

  it('uploads a file pasted into the input', () => {
    render(<TaskPaths taskId="task-1" />);
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText('Paste a path, URL or file'), {
      clipboardData: { files: [file], getData: () => '' },
    });
    expect(mocks.upload).toHaveBeenCalledWith({ file, todoId: 'task-1' });
  });
});
