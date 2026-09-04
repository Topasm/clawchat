import { platformApi } from '../platform';

const MARKDOWN_PATH_RE = /^(?:~\/|\/).+\.md$/iu;
const OBSIDIAN_URI_RE = /^obsidian:\/\/[^\s]+$/iu;

/** Read only the first description line; later prose can never become a path. */
export function extractCanonicalDoc(description: string | null | undefined): string | null {
  const firstLine = description?.split(/\r?\n/u, 1)[0]?.trim();
  if (!firstLine) return null;
  if (MARKDOWN_PATH_RE.test(firstLine) || OBSIDIAN_URI_RE.test(firstLine)) return firstLine;
  return null;
}

export async function openCanonicalDoc(target: string): Promise<'opened' | 'copied'> {
  if (platformApi.runtime.isDesktop) {
    try {
      await platformApi.system.openCanonicalDocument(target);
      return 'opened';
    } catch {
      // A moved or unavailable local file remains useful as a copied path.
    }
  }
  await navigator.clipboard.writeText(target);
  return 'copied';
}
