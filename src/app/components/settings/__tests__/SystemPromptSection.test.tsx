import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../../stores/useSettingsStore';
import SystemPromptSection from '../SystemPromptSection';

vi.mock('../../shared/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="Prompt text" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('SystemPromptSection', () => {
  beforeEach(() => {
    useSettingsStore.getState().setSystemPrompt(DEFAULT_SETTINGS.systemPrompt);
  });

  it('edits the prompt inline and saves it to the store', () => {
    render(<SystemPromptSection />);
    expect(screen.queryByLabelText('Prompt text')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Prompt text'), { target: { value: 'Be terse.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(useSettingsStore.getState().systemPrompt).toBe('Be terse.');
    expect(screen.queryByLabelText('Prompt text')).not.toBeInTheDocument();
  });

  it('resets the draft to the default without saving until asked', () => {
    useSettingsStore.getState().setSystemPrompt('Custom');
    render(<SystemPromptSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));

    expect(screen.getByLabelText('Prompt text')).toHaveValue(DEFAULT_SETTINGS.systemPrompt);
    expect(useSettingsStore.getState().systemPrompt).toBe('Custom');
  });
});
