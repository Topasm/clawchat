import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'markdown' | 'json';
  maxLength?: number;
  height?: string;
  placeholder?: string;
}

export default function CodeEditor({
  value,
  onChange,
  language = 'markdown',
  maxLength,
  height = '300px',
  placeholder,
}: CodeEditorProps) {
  const theme = useSettingsStore((s) => s.theme);

  const isDark = useMemo(() => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    // system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  const extensions = useMemo(() => {
    const exts = [];
    if (language === 'markdown') {
      exts.push(markdown());
    }
    return exts;
  }, [language]);

  const handleChange = (val: string) => {
    if (maxLength) {
      onChange(val.slice(0, maxLength));
    } else {
      onChange(val);
    }
  };

  return (
    <div className="cc-code-editor">
      <CodeMirror
        value={value}
        height={height}
        theme={isDark ? oneDark : undefined}
        extensions={extensions}
        onChange={handleChange}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          bracketMatching: true,
          foldGutter: false,
        }}
      />
    </div>
  );
}
