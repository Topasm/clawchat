import { useHotkeys } from 'react-hotkeys-hook';
import { isTextInput } from '../utils/helpers';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { translateUi } from '../i18n';
export default function useTodayHotkeys() {
  useHotkeys(
    't',
    (e) => {
      if (isTextInput(e)) return;
      e.preventDefault();
      useQuickCaptureStore
        .getState()
        .open({ placeholder: translateUi('New task: e.g. "Buy groceries tomorrow"') });
    },
    { enableOnFormTags: false },
  );
  useHotkeys(
    'e',
    (e) => {
      if (isTextInput(e)) return;
      e.preventDefault();
      useQuickCaptureStore
        .getState()
        .open({ placeholder: translateUi('New event: e.g. "Meeting at 3pm"') });
    },
    { enableOnFormTags: false },
  );
}
