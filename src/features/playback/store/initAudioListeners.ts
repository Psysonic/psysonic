import { setupAudioEngineListeners } from '@/features/playback/store/audioListenerSetup/audioEngineListeners';
import { runInitialAudioSync } from '@/features/playback/store/audioListenerSetup/initialAudioSync';
import { setupAuthSync } from '@/features/playback/store/audioListenerSetup/authSyncListener';
import { setupMprisSync } from '@/features/playback/store/audioListenerSetup/mprisSync';
import { setupRadioMprisMetadata } from '@/features/playback/store/audioListenerSetup/radioMprisMetadata';
import { setupTrackChangeNotification } from '@/features/playback/store/audioListenerSetup/trackChangeNotification';
import { setupDiscordPresence } from '@/features/playback/store/audioListenerSetup/discordPresence';
import { setupPrivateModePresence } from '@/features/playback/store/audioListenerSetup/privateModePresence';
import { setupEqDeviceSync } from '@/features/playback/store/audioListenerSetup/eqDeviceSync';
import { bindRadioEqAttachOnEnable } from '@/features/playback/store/radioPlayer';
import { bindRadioEqStore } from '@/features/playback/utils/audio/radioEqGraph';

/**
 * Set up Tauri event listeners for the Rust audio engine.
 * Returns a cleanup function — pass it to useEffect's return value so that
 * React StrictMode (which double-invokes effects in dev) tears down the first
 * set of listeners before creating the second, avoiding duplicate handlers.
 *
 * Each concern lives in its own module under `audioListenerSetup/`; this
 * function just composes them in the original setup / teardown order.
 */
export function initAudioListeners(): () => void {
  const stopEngineListeners = setupAudioEngineListeners();
  runInitialAudioSync();
  const stopAuthSync = setupAuthSync();
  const stopMprisSync = setupMprisSync();
  const stopRadioMprisMetadata = setupRadioMprisMetadata();
  const stopTrackChangeNotification = setupTrackChangeNotification();
  const stopDiscordPresence = setupDiscordPresence();
  const stopPrivateModePresence = setupPrivateModePresence();
  const stopEqDeviceSync = setupEqDeviceSync();
  const stopRadioEqStore = bindRadioEqStore();
  const stopRadioEqAttach = bindRadioEqAttachOnEnable();

  return () => {
    stopAuthSync();
    stopMprisSync();
    stopDiscordPresence();
    stopPrivateModePresence();
    stopEngineListeners();
    stopRadioMprisMetadata();
    stopTrackChangeNotification();
    stopEqDeviceSync();
    stopRadioEqStore();
    stopRadioEqAttach();
  };
}
