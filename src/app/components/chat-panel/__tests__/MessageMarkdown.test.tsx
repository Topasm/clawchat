import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MessageMarkdown from '../MessageMarkdown';

describe('MessageMarkdown', () => {
  it('draws bold, code and links instead of their markers', () => {
    const { container } = render(
      <MessageMarkdown text="Found **two** notes in `vault`: [Pricing](https://notion.so/p/1)." />,
    );
    expect(container.querySelector('strong')).toHaveTextContent('two');
    expect(container.querySelector('code')).toHaveTextContent('vault');
    const link = screen.getByRole('link', { name: 'Pricing' });
    expect(link).toHaveAttribute('href', 'https://notion.so/p/1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('](');
  });

  it('turns bullet and numbered lines into lists and keeps paragraphs apart', () => {
    const { container } = render(
      <MessageMarkdown
        text={'Plan:\n\n- read the spec\n- draft a reply\n\n1. first\n2. second\n\nDone.'}
      />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('links bare URLs without their trailing punctuation and never interprets HTML', () => {
    const { container } = render(
      <MessageMarkdown text={'See https://example.com/a/very/long/path?x=1. <b>raw</b>'} />,
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://example.com/a/very/long/path?x=1',
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>raw</b>');
  });

  it('keeps javascript: links as plain text and fenced code verbatim', () => {
    const { container } = render(
      <MessageMarkdown text={'[x](javascript:alert(1))\n```\nconst a = **1**;\n```'} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('pre code')).toHaveTextContent('const a = **1**;');
  });
});
