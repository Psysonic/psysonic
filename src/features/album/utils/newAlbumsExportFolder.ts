import { downloadDir } from '@tauri-apps/api/path';
import { commands } from '@/generated/bindings';
import { useAuthStore } from '@/store/authStore';

/** Where the export writes: the download folder from Settings, else the OS download folder. */
export async function resolveNewAlbumsExportFolder(): Promise<string> {
  const { downloadFolder } = useAuthStore.getState();
  return downloadFolder || await downloadDir();
}

/** Opens the folder in the OS file manager (Rust side; the shell plugin only allows https URLs). */
export async function openNewAlbumsExportFolder(folder: string): Promise<void> {
  const res = await commands.openFolder(folder);
  if (res.status === 'error') throw new Error(res.error);
}
