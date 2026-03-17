/**
 * Opens Obsidian to a specific vault using the obsidian:// URI scheme.
 */
export function getVaultName(vaultPath: string): string {
  const trimmed = vaultPath.replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).pop() || '';
}

export async function openObsidianVault(vaultPath: string): Promise<void> {
  const vaultName = getVaultName(vaultPath);
  if (!vaultName) return;

  const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;

  if (window.electronAPI?.server?.openObsidianVault) {
    await window.electronAPI.server.openObsidianVault();
  } else {
    window.open(uri, '_system');
  }
}
