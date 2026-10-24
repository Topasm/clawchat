import { Fragment, type ReactNode } from 'react';

/**
 * The little markdown an agent reply uses, drawn as text rather than shown
 * raw: paragraphs, headings, bullet and numbered lists, quotes, fenced and
 * inline code, bold, italic, strikethrough, links and bare URLs. No HTML is
 * ever interpreted, and only http(s) and mailto links are made clickable.
 */
export default function MessageMarkdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const BARE_URL = /https?:\/\/[^\s<>()]+/;

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence, if any
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quote });
      continue;
    }
    const bullet = /^\s*([-*•]|\d+[.)])\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (item && /\d/.test(item[1]) === ordered) {
          items.push(item[2]);
          index += 1;
        } else if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
          // A wrapped continuation line belongs to the item before it.
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^```/.test(lines[index]) &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

function renderBlocks(text: string): ReactNode[] {
  return parseBlocks(text).map((block, index) => {
    switch (block.kind) {
      case 'code':
        return (
          <pre key={index}>
            <code>{block.text}</code>
          </pre>
        );
      case 'heading':
        return <h3 key={index}>{renderInline(block.text)}</h3>;
      case 'quote':
        return <blockquote key={index}>{renderLines(block.lines)}</blockquote>;
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item)}</li>
        ));
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      default:
        return <p key={index}>{renderLines(block.lines)}</p>;
    }
  });
}

/** Lines of one paragraph, kept on their own lines as the model laid them out. */
function renderLines(lines: string[]): ReactNode[] {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ));
}

// One pass, first match wins: code span, link, bold, italic, strike, bare URL.
const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)',
    '(\\[([^\\]\\n]+)\\]\\(([^\\s)]+)\\))',
    '(\\*\\*([^*\\n]+?)\\*\\*)',
    '(__([^_\\n]+?)__)',
    '(\\*([^*\\n]+?)\\*)',
    '((?<![\\w])_([^_\\n]+?)_(?![\\w]))',
    '(~~([^~\\n]+?)~~)',
    `(${BARE_URL.source})`,
  ].join('|'),
  'g',
);

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const [whole] = match;
    if (match[1]) {
      out.push(<code key={key++}>{whole.slice(1, -1)}</code>);
    } else if (match[2]) {
      out.push(link(match[4], renderInline(match[3]), key++, whole));
    } else if (match[5]) {
      out.push(<strong key={key++}>{renderInline(match[6])}</strong>);
    } else if (match[7]) {
      out.push(<strong key={key++}>{renderInline(match[8])}</strong>);
    } else if (match[9]) {
      out.push(<em key={key++}>{renderInline(match[10])}</em>);
    } else if (match[11]) {
      out.push(<em key={key++}>{renderInline(match[12])}</em>);
    } else if (match[13]) {
      out.push(<del key={key++}>{renderInline(match[14])}</del>);
    } else {
      // A bare URL: trailing punctuation belongs to the sentence, not the link.
      const trimmed = whole.replace(/[.,;:!?'"]+$/, '');
      out.push(link(trimmed, trimmed, key++, trimmed));
      if (trimmed.length < whole.length) out.push(whole.slice(trimmed.length));
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function link(href: string, label: ReactNode, key: number, fallback: string): ReactNode {
  if (!SAFE_HREF.test(href)) return <Fragment key={key}>{fallback}</Fragment>;
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
