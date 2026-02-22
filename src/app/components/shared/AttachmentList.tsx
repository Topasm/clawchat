import { useAttachmentsQuery, useDeleteAttachment } from '../../hooks/queries';
import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import type { AttachmentResponse } from '../../types/schemas';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentListProps {
  ownerId: string;
  ownerType: 'memo' | 'todo';
}

export default function AttachmentList({ ownerId, ownerType }: AttachmentListProps) {
  const { data: attachments, isLoading } = useAttachmentsQuery(ownerId, ownerType);
  const deleteMutation = useDeleteAttachment();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const addToast = useToastStore((s) => s.addToast);

  if (isLoading || !attachments || attachments.length === 0) return null;

  const handleDelete = async (att: AttachmentResponse) => {
    try {
      await deleteMutation.mutateAsync({ id: att.id, ownerId });
      addToast('success', `Deleted ${att.filename}`);
    } catch {
      addToast('error', 'Failed to delete attachment');
    }
  };

  return (
    <div className="cc-attachments">
      <div className="cc-attachments__title">Attachments</div>
      {attachments.map((att) => {
        const isImage = IMAGE_TYPES.has(att.content_type);
        const downloadUrl = serverUrl ? `${serverUrl}${att.url}` : att.url;

        return (
          <div key={att.id} className="cc-attachments__item">
            {isImage ? (
              <img
                className="cc-attachments__preview"
                src={downloadUrl}
                alt={att.filename}
              />
            ) : (
              <div className="cc-attachments__file-icon">&#128196;</div>
            )}
            <div className="cc-attachments__info">
              <a
                className="cc-attachments__filename"
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {att.filename}
              </a>
              <span className="cc-attachments__size">{formatFileSize(att.size_bytes)}</span>
            </div>
            <button
              type="button"
              className="cc-attachments__delete"
              onClick={(e) => { e.stopPropagation(); handleDelete(att); }}
              title="Delete attachment"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
