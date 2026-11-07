import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useHistoryPosition } from '@/app/hooks/useHistoryPosition';
import { canGoBack, canGoForward } from '@/lib/navigation/historyPosition';
import { useThemeStore } from '@/store/themeStore';

/**
 * Back / forward through the app's own page history, at the start of the
 * content header. The same steps the mouse thumb buttons, the touchpad swipe
 * and the back / forward shortcuts take, for anyone who has none of them.
 * Hideable in Settings → Appearance; the shortcuts stay active either way.
 */
export function HistoryNavButtons() {
  const visible = useThemeStore(s => s.showHistoryNavButtons);
  if (!visible) return null;
  return <HistoryNavButtonGroup />;
}

function HistoryNavButtonGroup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const position = useHistoryPosition();
  const backEnabled = canGoBack(position);
  const forwardEnabled = canGoForward(position);
  const hideHint = t('common.historyNavHideHint', {
    settings: t('sidebar.settings'),
    tab: t('settings.tabAppearance'),
  });

  return (
    <div className="history-nav" role="group" aria-label={t('common.navigationHistory')}>
      <button
        type="button"
        className="history-nav-btn"
        onClick={() => { void navigate(-1); }}
        disabled={!backEnabled}
        aria-label={t('common.back')}
        data-tooltip={`${t('common.back')} — ${hideHint}`}
        data-tooltip-pos="bottom"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        className="history-nav-btn"
        onClick={() => { void navigate(1); }}
        disabled={!forwardEnabled}
        aria-label={t('common.forward')}
        data-tooltip={`${t('common.forward')} — ${hideHint}`}
        data-tooltip-pos="bottom"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
