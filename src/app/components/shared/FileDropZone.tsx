import { useCallback, useRef, useState } from 'react';
import { useUploadAttachment } from '../../hooks/queries';
import { useToastStore } from '../../stores/useToastStore';
import { isDemoMode } from '../../utils/helpers';

const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pdf', 'txt', 'md', 'zip',
]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

interface FileDropZoneProps {
  memoId?: string;
  todoId?: string;
  onUploadComplete?: () => void;
}

export default function FileDropZone({ memoId, todoId, onUploadComplete }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadAttachment();
  const addToast = useToastStore((s) => s.addToast);

  const validateFile = useCallback((file: File): string | null => {
    const ext = file.name.rsplit ? '' : file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return `File type '.${ext}' is not allowed`;
    }
    if (file.size > MAX_SIZE_BYTES) {
      return 'File exceeds maximum size of 10MB';
    }
    return null;
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    if (isDemoMode()) {
      addToast('info', 'File upload not available in demo mode');
      return;
    }

    const error = validateFile(file);
    if (error) {
      addToast('error', error);
      return;
    }

    try {
      await uploadMutation.mutateAsync({ file, memoId, todoId });
      addToast('success', `Uploaded ${file.name}`);
      onUploadComplete?.();
    } catch {
      addToast('error', 'Failed to upload file');
    }
  }, [memoId, todoId, uploadMutation, addToast, onUploadComplete, validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleUpload);
  }, [handleUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(handleUpload);
    if (inputRef.current) inputRef.current.value = '';
  }, [handleUpload]);

  return (
    <div
      className={`cc-dropzone${isDragOver ? ' cc-dropzone--active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        multiple
      />
      <div className="cc-dropzone__icon">&#128206;</div>
      <div className="cc-dropzone__text">Drop files here or click to browse</div>
      <div className="cc-dropzone__hint">
        JPG, PNG, GIF, WebP, SVG, PDF, TXT, MD, ZIP &middot; Max 10MB
      </div>
    </div>
  );
}
