import { translateUi } from '../i18n';

const SKILL_LABELS: Record<string, string> = {
  research: 'Research',
  draft: 'Draft',
  summarize: 'Summarize',
  data_analysis: 'Analyze',
  code_review: 'Review',
  prioritize: 'Prioritize',
  obsidian_sync: 'Sync',
  weekly_review: 'Weekly review',
  plan: 'Plan',
};

/** The short, translated name of a skill id; unknown ids show as they are. */
export function skillLabel(skillId: string): string {
  return translateUi(SKILL_LABELS[skillId] ?? skillId);
}

/** "Research → Summarize" for a chain; empty for none. */
export function skillChainLabel(chain: readonly string[] | null | undefined): string {
  return (chain ?? []).map(skillLabel).join(' → ');
}
