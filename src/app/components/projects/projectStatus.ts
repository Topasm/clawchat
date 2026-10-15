import type { ProjectStatus } from '../../types/api';
import { translateUi } from '../../i18n';

/**
 * A project's status in words, or null while it is active: almost every
 * project is, so saying it on each one is noise.
 */
export function projectStatusLabel(status: ProjectStatus): string | null {
  switch (status) {
    case 'planned':
      return translateUi('Planned');
    case 'completed':
      return translateUi('Completed');
    case 'archived':
      return translateUi('Archived');
    default:
      return null;
  }
}
