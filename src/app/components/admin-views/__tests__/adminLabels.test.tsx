import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage, translateUi } from '../../../i18n';
import AdminTabBar from '../AdminTabBar';
import { countLabel } from '../adminCounts';

afterEach(async () => {
  await changeAppLanguage('en');
});

describe('admin labels in Korean', () => {
  it('names every server tab in the app language', async () => {
    await changeAppLanguage('ko');
    render(<AdminTabBar activeTab="overview" onTabChange={vi.fn()} />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '개요',
      '데이터베이스',
      '활동',
      '세션',
      '서버 구성',
      '데이터 관리',
    ]);
  });

  it('names the counted rows in words, not column names', async () => {
    expect(countLabel('agent_tasks')).toBe('Agent runs');
    expect(countLabel('todos')).toBe('Tasks');
    expect(countLabel('vault_sync_jobs')).toBe('vault sync jobs');

    await changeAppLanguage('ko');
    expect(countLabel('todos')).toBe('작업');
    expect(countLabel('conversations')).toBe('대화');
  });

  it('has Korean words for the review filters', async () => {
    await changeAppLanguage('ko');
    expect(
      ['Needs review', 'Changes requested', 'Approved', 'Rejected'].map((label) =>
        translateUi(label),
      ),
    ).toEqual(['검토 필요', '수정 요청', '승인됨', '거부됨']);
  });
});
