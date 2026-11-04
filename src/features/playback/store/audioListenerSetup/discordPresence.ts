import { invoke } from '@tauri-apps/api/core';
import { commands } from '@/generated/bindings';
import { useAuthStore } from '@/store/authStore';
import { isPrivateModeActive, usePrivateModeStore } from '@/features/privateMode';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { getPlaybackProgressSnapshot, subscribePlaybackSeek } from '@/features/playback/store/playbackProgress';
import { resolveCoverForDiscord } from '@/cover/integrations/discord';
import type { CoverSourcePref } from '@/cover/coverSources';
import { allNormalizedAddresses, serverShareBaseUrl } from '@/lib/server/serverEndpoint';
import { playbackServerDiffersFromActive } from '@/features/playback/utils/playback/playbackServer';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Discord Rich Presence sync. Updates on track change, play/pause, or a committed
 * seek — not on progress ticks. Discord counts from the start timestamp and draws
 * a progress bar when the track duration supplies an end timestamp too.
 * Returns a cleanup function.
 */
export function setupDiscordPresence(): () => void {
  let discordPrevTrackKey: string | null = null;
  let discordPrevIsPlaying: boolean | null = null;
  let discordPrevTemplateDetails: string | null = null;
  let discordPrevTemplateState: string | null = null;
  let discordPrevTemplateLargeText: string | null = null;
  let discordPrevTemplateName: string | null = null;
  let discordPrevCoverSources: CoverSourcePref[] | null = null;
  let discordPrevDiscordCoverSource: string | null = null;
  let discordPrevShareBase: string | null = null;
  // null until this track's cover lookup has published once. A seek during
  // cover resolution waits out the lookup rather than publishing early with no image.
  let publishedCover: { url: string | null } | null = null;
  let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Position is read here, not when the update was scheduled, unless an explicit
  // elapsed position is passed (e.g. from a seek event).
  function publishPresence(coverArtUrl: string | null, elapsedSecsOverride?: number | null) {
    const { currentTrack, isPlaying } = usePlayerStore.getState();
    if (!currentTrack) return;
    const {
      discordTemplateDetails,
      discordTemplateState,
      discordTemplateLargeText,
      discordTemplateName,
    } = useAuthStore.getState();
    publishedCover = { url: coverArtUrl };
    const elapsedSecs =
      !isPlaying ? null
      : elapsedSecsOverride !== undefined ? elapsedSecsOverride
      : getPlaybackProgressSnapshot().currentTime;
    invoke('discord_update_presence', {
      title: currentTrack.title,
      artist: currentTrack.artist ?? 'Unknown Artist',
      album: currentTrack.album ?? null,
      isPlaying,
      elapsedSecs,
      durationSecs: currentTrack.duration,
      coverArtUrl,
      detailsTemplate: discordTemplateDetails,
      stateTemplate: discordTemplateState,
      largeTextTemplate: discordTemplateLargeText,
      nameTemplate: discordTemplateName,
    }).catch(() => {});
  }

  function syncDiscord() {
    const { currentTrack, isPlaying } = usePlayerStore.getState();
    const {
      discordRichPresence,
      discordCoverSource,
      coverSources,
      discordTemplateDetails,
      discordTemplateState,
      discordTemplateLargeText,
      discordTemplateName,
      servers,
      activeServerId,
    } = useAuthStore.getState();

    if (!discordRichPresence || !currentTrack || isPrivateModeActive()) {
      if (discordPrevTrackKey !== null) {
        discordPrevTrackKey = null;
        discordPrevIsPlaying = null;
        discordPrevCoverSources = null;
        discordPrevDiscordCoverSource = null;
        discordPrevShareBase = null;
        discordPrevTemplateDetails = null;
        discordPrevTemplateState = null;
        discordPrevTemplateLargeText = null;
        discordPrevTemplateName = null;
        publishedCover = null;
        if (seekDebounceTimer) {
          clearTimeout(seekDebounceTimer);
          seekDebounceTimer = null;
        }
        commands.discordClearPresence().catch(() => {});
      }
      return;
    }

    // Computed unconditionally (cheap: one array find + a URL normalize) so a
    // profile edit (fixing a LAN-only address to a public one, say) is caught
    // by shareBaseChanged below even when track/play-state/cover-source/
    // templates are all unchanged — the 'server' branch further down needs
    // this value regardless, so there is no second `getState()` read for it.
    const profile = servers.find(s => s.id === activeServerId);
    const shareBase = profile ? serverShareBaseUrl(profile) : null;
    const serverAddresses = profile ? allNormalizedAddresses(profile) : null;

    const currentTrackKey = ownedEntityKey(currentTrack);
    const trackChanged = currentTrackKey !== discordPrevTrackKey;
    const playingChanged = isPlaying !== discordPrevIsPlaying;
    const coverSourceChanged =
      coverSources !== discordPrevCoverSources ||
      discordCoverSource !== discordPrevDiscordCoverSource;
    const shareBaseChanged =
      discordCoverSource !== 'none' &&
      shareBase !== discordPrevShareBase;
    const detailsTemplateChanged = discordTemplateDetails !== discordPrevTemplateDetails;
    const stateTemplateChanged = discordTemplateState !== discordPrevTemplateState;
    const largeTextTemplateChanged = discordTemplateLargeText !== discordPrevTemplateLargeText;
    const nameTemplateChanged = discordTemplateName !== discordPrevTemplateName;
    if (!trackChanged && !playingChanged && !coverSourceChanged && !shareBaseChanged && !detailsTemplateChanged && !stateTemplateChanged && !largeTextTemplateChanged && !nameTemplateChanged) return;

    discordPrevTrackKey = currentTrackKey;
    discordPrevIsPlaying = isPlaying;
    discordPrevCoverSources = coverSources;
    discordPrevDiscordCoverSource = discordCoverSource;
    discordPrevShareBase = shareBase;
    discordPrevTemplateDetails = discordTemplateDetails;
    discordPrevTemplateState = discordTemplateState;
    discordPrevTemplateLargeText = discordTemplateLargeText;
    discordPrevTemplateName = discordTemplateName;
    if (trackChanged) {
      publishedCover = null;
      if (seekDebounceTimer) {
        clearTimeout(seekDebounceTimer);
        seekDebounceTimer = null;
      }
    }

    // What Discord may publish is a separate opt-in from the in-app chain
    // (#1299): 'none' shows the app icon only — nothing is fetched, nothing is
    // published. 'server' publishes the ordered in-app chain verbatim (every
    // URL still passes the credential-blind sanitizer + placeholder filter).
    // 'apple' publishes the chain with the 'server' row dropped: external
    // lookups need no server, so this can never publish a server share URL.
    // getAlbumInfo2 always queries the *active* server, so a mixed-server
    // queue whose playing track isn't from the active server must skip the
    // 'server' source rather than ask the wrong server for that album id (PR
    // #1246 context) — we pass no albumId in that case, which makes the
    // 'server' step a no-op and the chain falls through to apple/lastfm.
    const trackKey = currentTrackKey;
    const publishSources =
      discordCoverSource === 'none' ? []
      : discordCoverSource === 'apple'
        ? coverSources.filter(s => s.source !== 'server')
        : coverSources;
    const albumId =
      !playbackServerDiffersFromActive()
        ? (currentTrack.albumId || (currentTrack.coverArt?.startsWith('al-') ? currentTrack.coverArt : undefined))
        : undefined;
    const chainCtx = {
      albumId,
      artist: currentTrack.artist ?? undefined,
      album: currentTrack.album ?? undefined,
      title: currentTrack.title ?? undefined,
      shareBase,
      serverAddresses,
    };
    void (async () => {
      const url = await resolveCoverForDiscord(publishSources, chainCtx);
      // Staleness guard: drop if playback moved on, presence disabled, or the
      // gate/chain changed while requests were in flight.
      const latest = useAuthStore.getState();
      const liveTrack = usePlayerStore.getState().currentTrack;
      if (!liveTrack || ownedEntityKey(liveTrack) !== trackKey) return;
      if (!latest.discordRichPresence || isPrivateModeActive()) return;
      if (latest.discordCoverSource !== discordCoverSource || latest.coverSources !== coverSources) return;
      publishPresence(url);
    })();
  }

  const unsubDiscordPlayer = usePlayerStore.subscribe(syncDiscord);
  const unsubDiscordAuth = useAuthStore.subscribe(syncDiscord);
  const unsubDiscordPrivate = usePrivateModeStore.subscribe(syncDiscord);
  // Fires once per committed seek. Trailing debounce (300ms) protects against
  // Discord's activity rate limit when clicking rapidly or scrubbing with arrow keys.
  const unsubDiscordSeek = subscribePlaybackSeek((targetSeconds: number) => {
    if (discordPrevTrackKey == null) return;
    const { currentTrack, isPlaying } = usePlayerStore.getState();
    if (!currentTrack || !isPlaying) return;
    const seekTrackKey = ownedEntityKey(currentTrack);
    if (seekTrackKey !== discordPrevTrackKey) return;
    if (!useAuthStore.getState().discordRichPresence || isPrivateModeActive()) return;
    if (!publishedCover) return;
    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      seekDebounceTimer = null;
      const liveTrack = usePlayerStore.getState().currentTrack;
      if (!liveTrack || ownedEntityKey(liveTrack) !== seekTrackKey) return;
      publishPresence(publishedCover?.url ?? null, targetSeconds);
    }, 300);
  });

  return () => {
    if (seekDebounceTimer) {
      clearTimeout(seekDebounceTimer);
      seekDebounceTimer = null;
    }
    unsubDiscordPlayer();
    unsubDiscordAuth();
    unsubDiscordPrivate();
    unsubDiscordSeek();
  };
}
