import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import { resetAuthStore, resetPlayerStore } from '@/test/helpers/storeReset';
import { makeTrack } from '@/test/helpers/factories';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { registerDefaultCoverInvokeHandlers } from '@/test/mocks/tauri';
import { handleAudioFormat } from '@/features/playback/store/audioEventHandlers';
import i18n from '@/lib/i18n';
import { QueueCurrentTrack } from './QueueCurrentTrack';

function renderCurrent(track = makeTrack({ id: 'track-1', serverId: 'server-1', suffix: 'flac' })) {
  const ref = { current: null };
  return renderWithProviders(<QueueCurrentTrack
    currentTrack={track} userRatingOverrides={{}} orbitAttributionLabel={() => null}
    navigate={() => undefined} playbackSource={null} normalizationEngine="off"
    normalizationEngineLive="off" normalizationNowDb={null} normalizationTargetLufs={null}
    authLoudnessTargetLufs={-14} loudnessPreAnalysisAttenuationDb={0}
    expandReplayGain={false} setExpandReplayGain={() => undefined}
    reanalyzeLoudnessForTrack={() => undefined} setLoudnessTargetLufs={() => undefined}
    lufsTgtOpen={false} setLufsTgtOpen={() => undefined} lufsTgtBtnRef={ref}
    lufsTgtMenuRef={ref} lufsTgtPopStyle={{}} t={i18n.t.bind(i18n)}
  />);
}

describe('QueueCurrentTrack keeps channel information in Song Info only', () => {
  beforeEach(() => {
    resetPlayerStore();
    resetAuthStore();
    registerDefaultCoverInvokeHandlers();
  });

  it.each([false, true])('does not add channel information to the technical line (verified: %s)', verified => {
    const track = makeTrack({ id: 'track-1', serverId: 'server-1', suffix: 'flac' });
    usePlayerStore.setState({ currentTrack: track });
    handleAudioFormat({
      trackId: track.id, serverId: track.serverId, generation: 1, codec: 'flac', lossless: true,
      channels: 6,
      channelLayout: verified ? { mainChannels: 5, lfeChannels: 1, provenance: 'flac-mask' } : undefined,
    });
    const view = renderCurrent(track);
    const tech = view.container.querySelector('.queue-current-tech-main');
    expect(tech).toHaveTextContent('FLAC');
    expect(tech).not.toHaveTextContent(/(?:5\.1|6\.0|6\s?ch)/);
  });
});
