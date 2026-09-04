import { useToastStore } from '../../stores/useToastStore';
import { openCanonicalDoc } from '../../utils/canonicalDoc';
import { translateUi } from '../../i18n';

export default function CanonicalDocumentButton({ target }: { target: string | null }) {
  const addToast = useToastStore((state) => state.addToast);
  if (!target) return null;

  return (
    <button
      type="button"
      className="cc-btn cc-btn--ghost"
      onClick={async () => {
        try {
          const result = await openCanonicalDoc(target);
          if (result === 'copied') {
            addToast('info', translateUi('Document path copied'));
          }
        } catch {
          addToast('error', translateUi('Could not open or copy the original document'));
        }
      }}
    >
      {translateUi('Open original document')}
    </button>
  );
}
