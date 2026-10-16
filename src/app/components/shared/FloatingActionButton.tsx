import { useLocation } from 'react-router-dom';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';
import { hapticMedium } from '../../utils/haptics';
import { PlusIcon } from './Icons';
import { translateUi } from '../../i18n';
// Detail pages, settings, admin and search have no use for a new item; the
// Inbox has its input at the foot of the page.
const HIDDEN_PATTERNS = [
  /^\/(tasks|chats|events|projects)\/[^/]+/,
  /^\/(settings|admin|search|inbox)/,
];
/** On phones the ⌘N input opens from this button. */
export default function FloatingActionButton() {
  const location = useLocation();
  if (HIDDEN_PATTERNS.some((p) => p.test(location.pathname))) return null;
  return (
    <div className="cc-fab">
      <button
        type="button"
        className="cc-fab__button"
        onClick={() => {
          hapticMedium();
          useQuickCaptureStore.getState().open();
        }}
        aria-label={translateUi('Add to Inbox')}
      >
        <PlusIcon size={24} />
      </button>
    </div>
  );
}
