import { useHotkeys } from 'react-hotkeys-hook';
import { isTextInput } from '../utils/helpers';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
export default function useTodayHotkeys() {
  useHotkeys(
    't',
    (e) => {
      if (isTextInput(e)) return;
      e.preventDefault();
      useQuickCaptureStore.getState().open();
    },
    { enableOnFormTags: false },
  );
}
