import { platformApi } from '../platform';

/**
 * Opens Obsidian to a specific vault using the obsidian:// URI scheme.
 */
function getVaultName(vaultPath: string): string {
  const trimmed = vaultPath.replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).pop() || '';
}

export async function openObsidianVault(vaultPath: string): Promise<void> {
  const vaultName = getVaultName(vaultPath);
  if (!vaultName) return;

  const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;

  if (platformApi.runtime.isDesktop) {
    await platformApi.server.openObsidianVault();
  } else {
    window.open(uri, '_system');
  }
}
