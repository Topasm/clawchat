import { useMemo } from 'react';
import { useAgentRunPatchQuery } from '../../hooks/queries';
import { translateUi } from '../../i18n';
import { parseUnifiedDiff, type DiffLine } from '../../utils/unifiedDiff';

const LINE_MARK: Record<DiffLine['kind'], string> = {
  add: '+',
  del: '−',
  context: ' ',
  hunk: '',
  note: '',
};

/** The patch a run recorded, file by file, loaded when it is opened. */
export default function RunChangesView({ runId }: { runId: string }) {
  const { data: patch, isLoading, isError } = useAgentRunPatchQuery(runId, true);
  const files = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch]);
  if (isLoading) {
    return <p className="cc-run-changes__status">{translateUi('Loading changes…')}</p>;
  }
  if (isError) {
    return (
      <p className="cc-run-changes__status">{translateUi('The changes could not be loaded.')}</p>
    );
  }
  if (files.length === 0) {
    return (
      <p className="cc-run-changes__status">
        {translateUi('No patch was recorded for this result.')}
      </p>
    );
  }
  return (
    <div className="cc-run-changes" aria-label={translateUi('Changes')}>
      {files.map((file, index) => (
        <section key={`${file.path}-${index}`} className="cc-run-changes__file">
          <header className="cc-run-changes__file-header">
            <span className="cc-run-changes__file-path">{file.path || translateUi('Patch')}</span>
            {(file.additions > 0 || file.deletions > 0) && (
              <span className="cc-run-changes__counts">
                <span className="cc-run-changes__count--add">+{file.additions}</span>{' '}
                <span className="cc-run-changes__count--del">−{file.deletions}</span>
              </span>
            )}
          </header>
          <pre className="cc-run-changes__lines">
            {file.lines.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={`cc-run-changes__line cc-run-changes__line--${line.kind}`}
              >
                <span className="cc-run-changes__mark" aria-hidden="true">
                  {LINE_MARK[line.kind]}
                </span>
                {line.text || ' '}
                {'\n'}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
