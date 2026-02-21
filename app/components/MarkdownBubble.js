import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

const CODE_BG = '#1E1E1E';
const CODE_TEXT = '#D4D4D4';
const INLINE_CODE_BG_LIGHT = '#E8E8E8';
const INLINE_CODE_BG_DARK = '#3A3A3C';

function CodeBlock({ language, content }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <View style={codeStyles.container}>
      <View style={codeStyles.header}>
        <Text style={codeStyles.language}>
          {language || 'code'}
        </Text>
        <TouchableOpacity onPress={handleCopy} style={codeStyles.copyBtn}>
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={14}
            color={copied ? '#4CAF50' : '#999'}
          />
          <Text style={[codeStyles.copyText, copied && { color: '#4CAF50' }]}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={true} style={codeStyles.scrollView}>
        <Text style={codeStyles.code} selectable>
          {content}
        </Text>
      </ScrollView>
    </View>
  );
}

const codeStyles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 6,
    backgroundColor: CODE_BG,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2D2D2D',
  },
  language: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copyText: {
    fontSize: 11,
    color: '#999',
  },
  scrollView: {
    padding: 12,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: CODE_TEXT,
    lineHeight: 20,
  },
});

export default function MarkdownBubble({ text, isUser, style }) {
  if (!text) return null;

  // Pre-process: extract fenced code blocks and replace with placeholders
  const parts = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  let partIndex = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      parts.push({ type: 'markdown', content: text.slice(lastIndex, match.index), key: `md-${partIndex++}` });
    }
    // The code block itself
    parts.push({
      type: 'code',
      language: match[1] || '',
      content: match[2].replace(/\n$/, ''),
      key: `code-${partIndex++}`,
    });
    lastIndex = match.index + match[0].length;
  }
  // Remaining text after last code block
  if (lastIndex < text.length) {
    parts.push({ type: 'markdown', content: text.slice(lastIndex), key: `md-${partIndex++}` });
  }

  // If no code blocks found, render everything as markdown
  if (parts.length === 0) {
    parts.push({ type: 'markdown', content: text, key: 'md-0' });
  }

  const textColor = isUser ? '#FFFFFF' : '#1C1C1E';
  const linkColor = isUser ? '#B3D9FF' : '#2196F3';
  const inlineCodeBg = isUser ? 'rgba(255,255,255,0.2)' : INLINE_CODE_BG_LIGHT;
  const blockquoteBorder = isUser ? 'rgba(255,255,255,0.4)' : '#CCC';
  const blockquoteBg = isUser ? 'rgba(255,255,255,0.1)' : '#F5F5F5';

  const mdStyles = {
    body: {
      color: textColor,
      fontSize: 16,
      lineHeight: 22,
    },
    heading1: {
      color: textColor,
      fontSize: 22,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 4,
    },
    heading2: {
      color: textColor,
      fontSize: 19,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 3,
    },
    heading3: {
      color: textColor,
      fontSize: 17,
      fontWeight: '600',
      marginTop: 4,
      marginBottom: 2,
    },
    strong: {
      fontWeight: '700',
      color: textColor,
    },
    em: {
      fontStyle: 'italic',
      color: textColor,
    },
    s: {
      textDecorationLine: 'line-through',
      color: textColor,
    },
    link: {
      color: linkColor,
      textDecorationLine: 'underline',
    },
    blockquote: {
      backgroundColor: blockquoteBg,
      borderLeftWidth: 3,
      borderLeftColor: blockquoteBorder,
      paddingLeft: 10,
      paddingVertical: 4,
      marginVertical: 4,
    },
    code_inline: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      backgroundColor: inlineCodeBg,
      color: textColor,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
    },
    // For any code_block that slips through (without fences)
    code_block: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      backgroundColor: CODE_BG,
      color: CODE_TEXT,
      padding: 12,
      borderRadius: 8,
      marginVertical: 4,
    },
    fence: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      backgroundColor: CODE_BG,
      color: CODE_TEXT,
      padding: 12,
      borderRadius: 8,
      marginVertical: 4,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
    list_item: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bullet_list_icon: {
      color: textColor,
      marginRight: 4,
    },
    ordered_list_icon: {
      color: textColor,
      marginRight: 4,
    },
    hr: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.3)' : '#E0E0E0',
      height: 1,
      marginVertical: 8,
    },
    table: {
      borderWidth: 1,
      borderColor: isUser ? 'rgba(255,255,255,0.3)' : '#E0E0E0',
      borderRadius: 4,
      marginVertical: 4,
    },
    thead: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : '#F5F5F5',
    },
    th: {
      padding: 6,
      color: textColor,
      fontWeight: '600',
    },
    td: {
      padding: 6,
      color: textColor,
    },
    tr: {
      borderBottomWidth: 1,
      borderBottomColor: isUser ? 'rgba(255,255,255,0.2)' : '#E0E0E0',
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 4,
    },
  };

  return (
    <View style={[bubbleStyles.container, style]}>
      {parts.map((part) => {
        if (part.type === 'code') {
          return (
            <CodeBlock
              key={part.key}
              language={part.language}
              content={part.content}
            />
          );
        }
        // Markdown text part
        const trimmed = part.content.trim();
        if (!trimmed) return null;
        return (
          <Markdown key={part.key} style={mdStyles}>
            {trimmed}
          </Markdown>
        );
      })}
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
});
