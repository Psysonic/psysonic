import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import VisualizerCanvas from '@/features/visualizer/components/VisualizerCanvas';
import { useVisualizerCoverArt } from '@/features/visualizer/hooks/useVisualizerCoverArt';
import { useVisualizerStore } from '@/features/visualizer/store/visualizerStore';

/**
 * The visualizer as currently configured, for the settings page: it follows
 * playback when there is any and a built-in demo signal otherwise, so every
 * control can be judged without leaving the page.
 */
export default function VisualizerPreview(): React.ReactElement {
  const { t } = useTranslation();
  const mode = useVisualizerStore(s => s.mode);
  const { artUrl, artKey } = useVisualizerCoverArt();
  const [live, setLive] = useState(false);

  return (
    <div className="psy-viz-preview" role="group" aria-label={t('visualizer.settings.preview')}>
      <div className="psy-viz-panel" data-mode={mode}>
        <VisualizerCanvas
          artUrl={artUrl}
          artKey={artKey}
          demoWhenIdle
          onLiveChange={setLive}
        />
      </div>
      <p className="settings-hint psy-viz-preview-source">
        {live ? t('visualizer.settings.previewLive') : t('visualizer.settings.previewDemo')}
      </p>
    </div>
  );
}
