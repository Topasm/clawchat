import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { isTextInput } from '../utils/helpers';

export default function useTodayHotkeys() {
  const [showCapture, setShowCapture] = useState(false);
  const [capturePlaceholder, setCapturePlaceholder] = useState('');

  useHotkeys('t', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New task: e.g. "Buy groceries tomorrow"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  useHotkeys('e', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New event: e.g. "Meeting at 3pm"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  useHotkeys('n', (e) => {
    if (isTextInput(e)) return;
    e.preventDefault();
    setCapturePlaceholder('New memo: e.g. "Remember to check logs"');
    setShowCapture(true);
  }, { enableOnFormTags: false });

  return { showCapture, setShowCapture, capturePlaceholder };
}
