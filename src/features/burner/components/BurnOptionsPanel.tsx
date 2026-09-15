import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { BurnMediaInfo } from '@/lib/api/burn';

export interface BurnSettings {
  writeSpeed: number | null;
  testWrite: boolean;
  gapless: boolean;
  normalize: boolean;
  ejectWhenDone: boolean;
  cdText: boolean;
}

export interface BurnOptionsPanelProps {
  settings: BurnSettings;
  onChange: (patch: Partial<BurnSettings>) => void;
  media: BurnMediaInfo | null;
  /** From the drive's own feature page, not an assumption. */
  cdTextSupported: boolean;
  /** Why it is unsupported, when it is — shown so the user blames the right thing. */
  cdTextReason: string | null;
  /** Read CD-TEXT back off the disc currently loaded. */
  disabled: boolean;
}

function speedLabel(sectorsPerSecond: number): string {
  return `${Math.round(sectorsPerSecond / 75)}×`;
}

/**
 * One switch.
 *
 * The explanation rides on `title` rather than a permanent second line: four
 * always-on hints cost ~80px of the column that the running order wants, and
 * these settings are read once and then left alone.
 */
function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="burner-toggle" htmlFor={id} title={hint}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="burner-toggle-track" aria-hidden="true" />
      <span className="burner-toggle-text">{label}</span>
    </label>
  );
}

export default function BurnOptionsPanel({
  settings,
  onChange,
  media,
  cdTextSupported,
  cdTextReason,
  disabled,
}: BurnOptionsPanelProps) {
  const { t } = useTranslation();
  const speeds = media?.writeSpeeds ?? [];

  return (
    <div className="burner-options">
      <div className="burner-option-row">
        <label htmlFor="burner-speed">{t('burner.writeSpeed')}</label>
        <select
          id="burner-speed"
          value={settings.writeSpeed ?? ''}
          disabled={disabled || speeds.length === 0}
          onChange={event =>
            onChange({ writeSpeed: event.target.value === '' ? null : Number(event.target.value) })
          }
        >
          <option value="">{t('burner.speedAuto')}</option>
          {speeds.map(speed => (
            <option key={speed} value={speed}>{speedLabel(speed)}</option>
          ))}
        </select>
      </div>

      <Toggle
        id="burner-gapless"
        checked={settings.gapless}
        onChange={gapless => onChange({ gapless })}
        label={t('burner.gapless')}
        hint={t('burner.gaplessHint')}
        disabled={disabled}
      />

      <Toggle
        id="burner-normalize"
        checked={settings.normalize}
        onChange={normalize => onChange({ normalize })}
        label={t('burner.normalize')}
        hint={t('burner.normalizeHint')}
        disabled={disabled}
      />

      <Toggle
        id="burner-eject"
        checked={settings.ejectWhenDone}
        onChange={ejectWhenDone => onChange({ ejectWhenDone })}
        label={t('burner.ejectWhenDone')}
        disabled={disabled}
      />

      {/*
        Shown disabled rather than hidden when the drive cannot do it: people
        come to this screen looking for CD-TEXT, and silence reads as the
        feature being broken rather than as their hardware saying no.
      */}
      <Toggle
        id="burner-cdtext"
        checked={settings.cdText && cdTextSupported}
        onChange={cdText => onChange({ cdText })}
        label={t('burner.cdText')}
        hint={cdTextSupported ? t('burner.cdTextHint') : (cdTextReason ?? undefined)}
        disabled={disabled || !cdTextSupported}
      />

      {!cdTextSupported && cdTextReason && (
        <div className="burner-note">
          <Info size={13} aria-hidden="true" />
          <span>{cdTextReason}</span>
        </div>
      )}
    </div>
  );
}
