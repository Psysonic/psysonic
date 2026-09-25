/**
 * Event subscriptions (`library:sync-progress` / `library:sync-idle`, §7.2) plus
 * the genre-tags startup backfill commands. Split out of the former single
 * `lib/api/library.ts`; re-exported via the `@/lib/api/library` barrel.
 */
import { commands, type MoodTagsInspectDto } from '@/generated/bindings';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type {
  LibrarySyncProgressPayload,
  LibrarySyncIdlePayload,
  GenreTagsInspectDto,
  ScopeBrowseProjectionInspectDto,
} from './dto';

export function subscribeLibrarySyncProgress(
  handler: (payload: LibrarySyncProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<LibrarySyncProgressPayload>('library:sync-progress', ({ payload }) =>
    handler(payload),
  );
}

export function subscribeLibrarySyncIdle(
  handler: (payload: LibrarySyncIdlePayload) => void,
): Promise<UnlistenFn> {
  return listen<LibrarySyncIdlePayload>('library:sync-idle', ({ payload }) =>
    handler(payload),
  );
}

export async function libraryGenreTagsInspect(): Promise<GenreTagsInspectDto> {
  const res = await commands.libraryGenreTagsInspect();
  if (res.status === 'error') throw new Error(res.error);
  return res.data;
}

export async function libraryGenreTagsRun(): Promise<void> {
  const res = await commands.libraryGenreTagsRun();
  if (res.status === 'error') throw new Error(res.error);
}

export async function libraryFileMoodTagsInspect(): Promise<MoodTagsInspectDto> {
  const res = await commands.libraryFileMoodTagsInspect();
  if (res.status === 'error') throw new Error(res.error);
  return res.data;
}

export async function libraryFileMoodTagsRun(): Promise<void> {
  const res = await commands.libraryFileMoodTagsRun();
  if (res.status === 'error') throw new Error(res.error);
}

export function libraryScopeBrowseProjectionInspect(): Promise<ScopeBrowseProjectionInspectDto> {
  return invoke('library_scope_browse_projection_inspect');
}

export function libraryScopeBrowseProjectionRun(): Promise<void> {
  return invoke('library_scope_browse_projection_run');
}
