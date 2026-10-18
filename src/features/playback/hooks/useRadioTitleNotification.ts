import { useEffect, useRef } from 'react';
import { radioCoverRef } from '@/cover/ref';
import { coverArtPathForNotification } from '@/cover/integrations/notification';
import type { RadioMetadata } from '@/features/radio';
import { usePlayerStore } from '@/features/playback/store/playerStore';
import { radioNotificationContent } from '@/features/playback/utils/notifications/trackNotificationContent';
import { trackNotificationScheduler } from '@/features/playback/utils/notifications/trackNotificationScheduler';
import type { InternetRadioStation } from '@/lib/api/subsonicTypes';
import { ownedEntityKey } from '@/lib/util/ownedEntityKey';

/**
 * Desktop notification when an internet radio stream reports a new title. Reads
 * the same resolved metadata the player bar shows; a station without track
 * metadata stays silent. Mount once, in the always-present player bar.
 */
export function useRadioTitleNotification(
  radioMeta: RadioMetadata,
  currentRadio: InternetRadioStation | null,
): void {
  const latestKeyRef = useRef<string | null>(null);
  const title = radioMeta.source === 'none' ? undefined : radioMeta.currentTitle;
  const artist = radioMeta.currentArtist;

  useEffect(() => {
    if (!currentRadio || !title) {
      latestKeyRef.current = null;
      return;
    }
    const key = `radio:${ownedEntityKey(currentRadio)}|${artist ?? ''}|${title}`;
    latestKeyRef.current = key;
    trackNotificationScheduler.announce(
      key,
      async () => ({
        ...radioNotificationContent({ title, artist, stationName: currentRadio.name }),
        coverPath: currentRadio.coverArt
          ? await coverArtPathForNotification(radioCoverRef(currentRadio))
          : null,
      }),
      () => latestKeyRef.current === key && usePlayerStore.getState().isPlaying,
    );
  }, [currentRadio, title, artist]);
}
