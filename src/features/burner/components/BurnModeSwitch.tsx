import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface BurnModeSwitchProps {
  /** True when the next run is a rehearsal. Bound straight to the setting. */
  testWrite: boolean;
  onChange: (testWrite: boolean) => void;
  disabled: boolean;
}

/**
 * Burn, or rehearse.
 *
 * This is a mode, not a preference, and it belongs beside the button it
 * changes. It lived as a checkbox in the options column, four hundred pixels
 * away, and its only visible effect was that the primary button silently
 * retitled itself — so the control that decides whether a CD-R gets destroyed
 * was nowhere near the control that destroys it.
 *
 * No new state: it reads and writes the same `settings.testWrite` the checkbox
 * did, so nothing downstream had to learn a second source of truth.
 */
export default function BurnModeSwitch({ testWrite, onChange, disabled }: BurnModeSwitchProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  const options = [
    { key: 'burn', label: t('burner.modeBurn'), rehearsal: false },
    { key: 'rehearse', label: t('burner.modeRehearse'), rehearsal: true },
  ];

  /** Arrow keys move between the two, as a radio group is expected to. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = !testWrite;
    onChange(next);
    // Focus follows the selection: leaving it on the unchecked half would put
    // the ring and the checked state in different places.
    requestAnimationFrame(() => {
      ref.current
        ?.querySelectorAll<HTMLElement>('[role="radio"]')[next ? 1 : 0]
        ?.focus();
    });
  };

  return (
    <div
      ref={ref}
      className={`burner-mode-switch${testWrite ? ' is-rehearse' : ''}`}
      role="radiogroup"
      aria-label={t('burner.modeLabel')}
      onKeyDown={onKeyDown}
    >
      {/* Under the labels, so the moving part cannot cover the words. */}
      <span className="burner-mode-slider" aria-hidden="true" />
      {options.map(option => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={testWrite === option.rehearsal}
          // One tab stop for the pair; the arrows walk it from there.
          tabIndex={testWrite === option.rehearsal ? 0 : -1}
          className="burner-mode-option"
          disabled={disabled}
          onClick={() => onChange(option.rehearsal)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
