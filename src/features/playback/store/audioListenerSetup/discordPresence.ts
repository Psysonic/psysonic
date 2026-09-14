import { invoke } from '@tauri-apps/api/core';
import { commands } from '@/generated/bindings';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { getPlaybackProgressSnapshot } from '@/features/playback/store/playbackProgress';
import { resolveCoverForDiscord } from '@/cover/integrations/discord';
import type { CoverSourcePref } from '@/cover/coverSources';
import { serverShareBaseUrl } from '@/lib/server/serverEndpoint';
import { playbackServerDiffersFromActive } from '@/features/playback/utils/playback/playbackServer';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Discord Rich Presence sync. Updates on track change or play/pause toggle —
 * no per-tick updates needed, Discord auto-counts up the elapsed timer from the
 * start_timestamp we set. Returns a cleanup function.
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

  function syncDiscord() {
    const { currentTrack, isPlaying } = usePlayerStore.getState();
    const currentTime = getPlaybackProgressSnapshot().currentTime;
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

    if (!discordRichPresence || !currentTrack) {
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

    const sendPresence = (coverArtUrl: string | null) => {
      invoke('discord_update_presence', {
        title: currentTrack.title,
        artist: currentTrack.artist ?? 'Unknown Artist',
        album: currentTrack.album ?? null,
        isPlaying,
        elapsedSecs: isPlaying ? currentTime : null,
        coverArtUrl,
        detailsTemplate: discordTemplateDetails,
        stateTemplate: discordTemplateState,
        largeTextTemplate: discordTemplateLargeText,
        nameTemplate: discordTemplateName,
      }).catch(() => {});
    };

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
    const chainCtx = {
      albumId: !playbackServerDiffersFromActive() ? currentTrack.albumId : undefined,
      artist: currentTrack.artist ?? undefined,
      album: currentTrack.album ?? undefined,
      title: currentTrack.title ?? undefined,
      shareBase,
    };
    void (async () => {
      const url = await resolveCoverForDiscord(publishSources, chainCtx);
      // Staleness guard: drop if playback moved on, presence disabled, or the
      // gate/chain changed while requests were in flight.
      const latest = useAuthStore.getState();
      const liveTrack = usePlayerStore.getState().currentTrack;
      if (!liveTrack || ownedEntityKey(liveTrack) !== trackKey) return;
      if (!latest.discordRichPresence) return;
      if (latest.discordCoverSource !== discordCoverSource || latest.coverSources !== coverSources) return;
      sendPresence(url);
    })();
  }

  const unsubDiscordPlayer = usePlayerStore.subscribe(syncDiscord);
  const unsubDiscordAuth = useAuthStore.subscribe(syncDiscord);

  return () => {
    unsubDiscordPlayer();
    unsubDiscordAuth();
  };
}
