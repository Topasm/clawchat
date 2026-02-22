import { useCallback, useEffect, useMemo, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical';
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
} from '@lexical/list';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getNearestNodeOfType } from '@lexical/utils';
import type { EditorState, LexicalEditor } from 'lexical';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const EDITOR_THEME = {
  paragraph: 'cc-rte__paragraph',
  heading: {
    h1: 'cc-rte__h1',
    h2: 'cc-rte__h2',
    h3: 'cc-rte__h3',
  },
  list: {
    ul: 'cc-rte__ul',
    ol: 'cc-rte__ol',
    listitem: 'cc-rte__li',
    nested: { listitem: 'cc-rte__li--nested' },
  },
  link: 'cc-rte__link',
  text: {
    bold: 'cc-rte__bold',
    italic: 'cc-rte__italic',
    code: 'cc-rte__inline-code',
    underline: 'cc-rte__underline',
    strikethrough: 'cc-rte__strikethrough',
  },
  code: 'cc-rte__code-block',
  codeHighlight: {},
  quote: 'cc-rte__blockquote',
};

// ---------------------------------------------------------------------------
// Toolbar Plugin
// ---------------------------------------------------------------------------
function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        setIsBold(selection.hasFormat('bold'));
        setIsItalic(selection.hasFormat('italic'));

        const anchorNode = selection.anchor.getNode();
        const element = anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

        if ($isHeadingNode(element)) {
          setBlockType(element.getTag());
        } else if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType(anchorNode, ListNode);
          setBlockType(parentList ? parentList.getListType() : element.getListType());
        } else {
          setBlockType(element.getType());
        }
      });
    });
  }, [editor]);

  const btn = (
    label: string,
    title: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className={`cc-rte__toolbar-btn${active ? ' cc-rte__toolbar-btn--active' : ''}`}
      title={title}
      onClick={(e) => { e.preventDefault(); onClick(); }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <div className="cc-rte__toolbar">
      {btn('B', 'Bold', isBold, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'))}
      {btn('I', 'Italic', isItalic, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'))}
      <span className="cc-rte__toolbar-sep" />
      {btn('UL', 'Bullet List', blockType === 'bullet', () => {
        if (blockType === 'bullet') {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        } else {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        }
      })}
      {btn('OL', 'Numbered List', blockType === 'number', () => {
        if (blockType === 'number') {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        } else {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SetInitialContentPlugin — loads markdown on mount
// ---------------------------------------------------------------------------
function SetInitialContentPlugin({ markdown }: { markdown: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!markdown) return;
    editor.update(() => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    });
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// SaveShortcutPlugin — Ctrl+Enter
// ---------------------------------------------------------------------------
function SaveShortcutPlugin({ onSave }: { onSave?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onSave) return;
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onSave();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onSave]);

  return null;
}

// ---------------------------------------------------------------------------
// RichTextEditor (exported)
// ---------------------------------------------------------------------------
interface RichTextEditorProps {
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  onSave?: () => void;
}

export default function RichTextEditor({
  initialMarkdown = '',
  onChange,
  placeholder = 'Write something...',
  editable = true,
  onSave,
}: RichTextEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: 'RichTextEditor',
      theme: EDITOR_THEME,
      editable,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        CodeNode,
        CodeHighlightNode,
      ],
      onError: (error: Error) => {
        console.error('Lexical error:', error);
      },
    }),
    [editable],
  );

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      if (!onChange) return;
      editor.read(() => {
        const md = $convertToMarkdownString(TRANSFORMERS);
        onChange(md);
      });
    },
    [onChange],
  );

  return (
    <div className={`cc-rte${editable ? '' : ' cc-rte--readonly'}`}>
      <LexicalComposer initialConfig={initialConfig}>
        {editable && <ToolbarPlugin />}
        <div className="cc-rte__editor-wrapper">
          <RichTextPlugin
            contentEditable={<ContentEditable className="cc-rte__content" />}
            placeholder={
              editable ? <div className="cc-rte__placeholder">{placeholder}</div> : null
            }
            ErrorBoundary={({ children }) => <>{children}</>}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
        <SetInitialContentPlugin markdown={initialMarkdown} />
        <SaveShortcutPlugin onSave={onSave} />
      </LexicalComposer>
    </div>
  );
}
