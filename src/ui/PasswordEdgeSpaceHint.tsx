import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** True when the value starts or ends with whitespace. */
function hasEdgeWhitespace(value: string): boolean {
  return value !== value.trim();
}

interface PasswordEdgeSpaceHintProps {
  /** Referenced by the password input's `aria-describedby`. */
  id: string;
  password: string;
}

/**
 * Warns when a password starts or ends with a space — typically picked up by
 * double-click copying. The password itself stays as entered: a space can be
 * part of a real password, so stripping it silently would lock that user out.
 *
 * The live region is always mounted so screen readers announce the hint when
 * it appears, not only when the field is focused again.
 */
export function PasswordEdgeSpaceHint({ id, password }: PasswordEdgeSpaceHintProps) {
  const { t } = useTranslation();
  const show = hasEdgeWhitespace(password);
  return (
    <div id={id} role="status" aria-live="polite">
      {show && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginTop: 6,
            fontSize: 12,
            lineHeight: 1.4,
            color: 'var(--text-secondary)',
          }}
        >
          <AlertTriangle
            size={14}
            aria-hidden="true"
            style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }}
          />
          <span>{t('login.passwordEdgeSpace')}</span>
        </div>
      )}
    </div>
  );
}
