import { VenetianMask } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePrivateModeStore } from '../privateModeStore';

/** Header switch for private mode; lit while it is on. */
export default function PrivateModeToggle() {
  const { t } = useTranslation();
  const active = usePrivateModeStore(s => s.active);
  const toggle = usePrivateModeStore(s => s.toggle);
  return (
    <button
      type="button"
      className={`private-mode-toggle${active ? ' private-mode-toggle--active' : ''}`}
      onClick={toggle}
      aria-label={t('privateMode.label')}
      aria-pressed={active}
      data-tooltip={active ? t('privateMode.turnOff') : t('privateMode.turnOn')}
      data-tooltip-pos="bottom"
    >
      <VenetianMask size={18} aria-hidden />
    </button>
  );
}
