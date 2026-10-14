import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import {
  AudioLines, HardDrive, Info, Keyboard, LayoutGrid, Music2, Paintbrush, Palette, Search, Server, Sparkles, Users, X,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { IS_MACOS } from '@/lib/util/platform';
import { AppearanceTab } from '@/features/settings/components/AppearanceTab';
import { ThemesTab } from '@/features/settings/components/ThemesTab';
import { AudioTab } from '@/features/settings/components/AudioTab';
import { InputTab } from '@/features/settings/components/InputTab';
import { IntegrationsTab } from '@/features/settings/components/IntegrationsTab';
import { LibraryTab } from '@/features/settings/components/LibraryTab';
import { LyricsTab } from '@/features/settings/components/LyricsTab';
import { PersonalisationTab } from '@/features/settings/components/PersonalisationTab';
import { ServersTab } from '@/features/settings/components/ServersTab';
import { SettingsBottomSpacer } from '@/features/settings/components/SettingsBottomSpacer';
import { StorageTab } from '@/features/settings/components/StorageTab';
import { SystemTab } from '@/features/settings/components/SystemTab';
import { searchSettings, type SettingsSearchHit } from '@/features/settings/components/settingsSearch';
import { normalizeSearchText } from '@/features/settings/components/settingsSearchMatch';
import { TAB_LABEL_KEY, type Tab, resolveTab } from '@/features/settings/components/settingsTabs';
import { UserManagementSection } from '@/features/settings/components/UserManagementSection';
import { ndLogin } from '@/lib/api/navidromeAdmin';
import { type ServerMagicPayload } from '@/lib/server/serverMagicString';


export default function Settings() {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state;
  const { t, i18n } = useTranslation();
  const tEn = useMemo(() => i18n.getFixedT('en'), [i18n]);

  const [activeTab, setActiveTab] = useState<Tab>(resolveTab((routeState as { tab?: string } | null)?.tab));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedResultIdx, setSelectedResultIdx] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const [pendingServerInvite, setPendingServerInvite] = useState<ServerMagicPayload | null>(null);
  const [ndAdminAuth, setNdAdminAuth] = useState<{ token: string; serverUrl: string; username: string } | null>(null);
  const [ndAuthChecked, setNdAuthChecked] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsListRef = useRef<HTMLUListElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const st = routeState as { openAddServerInvite?: ServerMagicPayload; tab?: Tab; focus?: string } | null;
    const inv = st?.openAddServerInvite;
    if (inv) {
      // React Compiler set-state-in-effect rule: local state synced with store/prop inputs when the effect’s dependencies change.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingServerInvite(inv);
      setActiveTab('servers');
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: { tab: 'servers' as Tab } },
      );
      return;
    }
    if (st?.tab) setActiveTab(st.tab);
    // A caller can name the sub-section it means, which lands on the same
    // scroll-and-flash path the settings search uses.
    if (st?.focus) setPendingFocus({ title: st.focus });
  }, [routeState, location.pathname, location.search, location.hash, navigate]);

  // Settings-Suche: Volltext ueber Ueberschriften, Zeilen und Hinweise jeder
  // Section (generierter Index), tippfehlertolerant. Ergebnis ist eine flache
  // Liste nach Score, bei Gleichstand aktueller Tab zuerst. Wenn eine Query
  // aktiv ist, wird der Tab-Content nicht gerendert und stattdessen die
  // Ergebnisliste angezeigt. Abgeleitet statt als State: ein Effekt, der die
  // Liste setzt, rendert die Seite nach dem Admin-Login fuer den Users-Tab
  // ein weiteres Mal.
  const searchResults = useMemo(() => searchSettings(searchQuery, activeTab, t, {
    tEn,
    advancedEnabled: auth.advancedSettingsEnabled,
    usersAvailable: ndAdminAuth !== null,
  }), [searchQuery, activeTab, t, tEn, auth.advancedSettingsEnabled, ndAdminAuth]);

  // Selektion ins Blickfeld scrollen (nur wenn das Item out-of-view ist).
  useEffect(() => {
    if (!searchQuery || searchResults.length === 0) return;
    const list = searchResultsListRef.current;
    if (!list) return;
    const item = list.children[selectedResultIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedResultIdx, searchQuery, searchResults.length]);

  // Ctrl/Cmd+F oeffnet die Settings-Suche (nur auf der Settings-Seite — dieser
  // Effect ist ja an Settings gebunden). Fokussiert das Feld auch wenn's schon
  // offen ist. preventDefault blockt die native WebKit-Find-Bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      setSearchOpen(true);
      window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Nach Klick auf ein Ergebnis: Ziel-Sub-Section oeffnen, die gefundene Zeile
  // (sonst die Section) ins Bild scrollen und kurz highlighten, damit der User
  // auf dem neuen Tab sofort weiss welcher Eintrag gemeint war.
  useEffect(() => {
    if (!pendingFocus) return;
    const section = pendingFocus.title
      ? document.querySelector<HTMLElement>(`[data-settings-search="${CSS.escape(pendingFocus.title)}"]`)
      : null;
    const scope = pendingFocus.title ? section : pageRef.current;
    if (!scope) return;
    if (section instanceof HTMLDetailsElement) section.open = true;
    const row = pendingFocus.text ? findTextTarget(scope, pendingFocus.text) : null;
    const target = row ?? section;
    if (!target) {
      setPendingFocus(null);
      return;
    }
    const flashClass = row ? 'settings-search-flash' : 'settings-sub-section--flash';
    target.scrollIntoView({ behavior: 'smooth', block: row ? 'center' : 'start' });
    target.classList.remove(flashClass);
    // reflow, damit die Animation bei wiederholtem Klick auf dasselbe Ziel
    // erneut abspielt.
    void target.offsetWidth;
    target.classList.add(flashClass);
    const timer = window.setTimeout(() => {
      target.classList.remove(flashClass);
    }, 1700);
    setPendingFocus(null);
    return () => window.clearTimeout(timer);
  }, [pendingFocus, activeTab]);

  const openSearchHit = (hit: SettingsSearchHit) => {
    setSearchQuery('');
    setSearchOpen(false);
    setPendingFocus({ title: hit.focusTitle, text: hit.focusText });
    setActiveTab(hit.tab);
  };

  useEffect(() => {
    const server = auth.getActiveServer();
    // React Compiler set-state-in-effect rule: state set from a timer/animation callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNdAuthChecked(false);
    if (!server) { setNdAdminAuth(null); setNdAuthChecked(true); return; }
    const serverUrl = (server.url.startsWith('http') ? server.url : `http://${server.url}`).replace(/\/$/, '');
    let cancelled = false;
    ndLogin(serverUrl, server.username, server.password)
      .then(res => {
        if (cancelled) return;
        setNdAdminAuth(res.isAdmin ? { token: res.token, serverUrl, username: server.username } : null);
      })
      .catch(() => { if (!cancelled) setNdAdminAuth(null); })
      .finally(() => { if (!cancelled) setNdAuthChecked(true); });
    return () => { cancelled = true; };
    // Keyed on auth.activeServerId; the effect reads the active server via `auth`
    // but must only re-probe admin auth when the active server changes, not on
    // every auth-store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.activeServerId]);

  useEffect(() => {
    // React Compiler set-state-in-effect rule: state set from an async result resolved in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'users' && ndAuthChecked && ndAdminAuth === null) setActiveTab('servers');
  }, [activeTab, ndAdminAuth, ndAuthChecked]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'servers',         label: t('settings.tabServers'),         icon: <Server size={15} /> },
    { id: 'library',         label: t('settings.tabLibrary'),         icon: <Music2 size={15} /> },
    { id: 'audio',           label: t('settings.tabAudio'),           icon: <AudioLines size={15} /> },
    { id: 'themes',          label: t('settings.tabThemes'),          icon: <Paintbrush size={15} /> },
    { id: 'appearance',      label: t('settings.tabAppearance'),      icon: <Palette size={15} /> },
    { id: 'lyrics',          label: t('settings.tabLyrics'),          icon: <Music2 size={15} /> },
    { id: 'personalisation', label: t('settings.tabPersonalisation'), icon: <LayoutGrid size={15} /> },
    { id: 'integrations',    label: t('settings.tabIntegrations'),    icon: <Sparkles size={15} /> },
    { id: 'input',           label: t('settings.tabInput'),           icon: <Keyboard size={15} /> },
    { id: 'storage',         label: t('settings.tabStorage'),         icon: <HardDrive size={15} /> },
    { id: 'system',          label: t('settings.tabSystem'),          icon: <Info size={15} /> },
    ...(ndAdminAuth ? [{ id: 'users' as Tab, label: t('settings.tabUsers'), icon: <Users size={15} /> }] : []),
  ];

  return (
    <div ref={pageRef} className="content-body animate-fade-in">
      <div className="settings-header">
        <h1 className="page-title">{t('settings.title')}</h1>
        <div className="settings-search">
          {!searchOpen ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSearchOpen(true)}
              aria-label={t('settings.searchPlaceholder')}
              data-tooltip={t('settings.searchPlaceholder')}
              data-tooltip-pos="bottom"
            >
              <Search size={16} />
            </button>
          ) : (
            <div className="settings-search-wrap">
              <Search size={14} className="settings-search-icon" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                className="input settings-search-input"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setSelectedResultIdx(0);
                }}
                placeholder={`${t('settings.searchPlaceholder')} (${IS_MACOS ? '⌘F' : 'Ctrl+F'})`}
                aria-label={t('settings.searchPlaceholder')}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setSearchQuery('');
                    setSearchOpen(false);
                    return;
                  }
                  if (searchResults.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedResultIdx(i => Math.min(i + 1, searchResults.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedResultIdx(i => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const hit = searchResults[selectedResultIdx];
                    if (!hit) return;
                    openSearchHit(hit);
                  }
                }}
              />
              <button
                type="button"
                className="settings-search-clear"
                onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                aria-label={t('common.clear')}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        <label
          className="settings-advanced-toggle"
          data-tooltip={t('settings.advancedModeTooltip')}
          data-tooltip-pos="left"
        >
          <span className="settings-advanced-toggle-label">
            {t('settings.advancedMode')}
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={auth.advancedSettingsEnabled}
              onChange={e => auth.setAdvancedSettingsEnabled(e.target.checked)}
              aria-label={t('settings.advancedMode')}
            />
            <span className="toggle-track" />
          </span>
        </label>
      </div>

      {/* Tab navigation */}
      <nav className="settings-tabs" aria-label="Settings navigation">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {searchQuery && searchResults.length === 0 && (
        <div className="settings-search-empty" role="status">
          {t('settings.searchNoResults')}
        </div>
      )}

      {searchQuery && searchResults.length > 0 && (
        <ul ref={searchResultsListRef} className="settings-search-results">
          {searchResults.map((hit, idx) => {
            const tabLabelKey = TAB_LABEL_KEY[hit.tab];
            const selected = idx === selectedResultIdx;
            return (
              <li key={hit.key}>
                <button
                  type="button"
                  className="settings-search-result-item"
                  data-selected={selected ? 'true' : undefined}
                  onMouseEnter={() => setSelectedResultIdx(idx)}
                  onClick={() => openSearchHit(hit)}
                >
                  <span className="settings-search-result-badge">{t(tabLabelKey)}</span>
                  <span className="settings-search-result-text">
                    <span className="settings-search-result-title">{hit.title}</span>
                    {hit.context && (
                      <span className="settings-search-result-context">{stripMarkup(hit.context)}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!searchQuery && <>
      {/* ── Audio ────────────────────────────────────────────────────────────── */}
      {activeTab === 'audio' && <AudioTab />}

      {/* ── Lyrics ───────────────────────────────────────────────────────────── */}
      {activeTab === 'lyrics' && <LyricsTab />}

      {/* ── Integrations ─────────────────────────────────────────────────────── */}
      {activeTab === 'integrations' && <IntegrationsTab />}


      {/* ── Personalisation ──────────────────────────────────────────────────── */}
      {activeTab === 'personalisation' && <PersonalisationTab />}

      {/* ── Library (legacy 'general' + 'server') ────────────────────────────── */}
      {activeTab === 'library' && <LibraryTab />}


      {/* ── Offline & Cache ──────────────────────────────────────────────────── */}
      {activeTab === 'storage' && <StorageTab />}

      {/* ── Appearance ───────────────────────────────────────────────────────── */}
      {activeTab === 'appearance' && <AppearanceTab />}

      {/* ── Themes ───────────────────────────────────────────────────────────── */}
      {activeTab === 'themes' && <ThemesTab />}

      {/* ── Input ────────────────────────────────────────────────────────────── */}
      {activeTab === 'input' && <InputTab />}


      {/* ── Server ───────────────────────────────────────────────────────────── */}
      {activeTab === 'servers' && (
        <ServersTab initialInvite={pendingServerInvite} />
      )}

      {/* ── Users ────────────────────────────────────────────────────────────── */}
      {activeTab === 'users' && ndAdminAuth && (
        <UserManagementSection
          serverUrl={ndAdminAuth.serverUrl}
          token={ndAdminAuth.token}
          currentUsername={ndAdminAuth.username}
        />
      )}

      {/* ── System ───────────────────────────────────────────────────────────── */}
      {activeTab === 'system' && <SystemTab />}

      </>}

      <SettingsBottomSpacer />
    </div>
  );
}

/** Ziel nach einem Suchtreffer: Section ueber ihren `data-settings-search`-Titel, darin die gefundene Zeile. */
type PendingFocus = { title?: string; text?: string };

const ROW_SELECTOR = '.settings-toggle-row, .settings-norm-row';

function stripMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '…');
}

// Das Element mit dem kuerzesten Text, der den Treffer noch enthaelt — also die
// Zeile bzw. das Label selbst, nicht die umgebende Gruppe. Platzhalter wie
// {{count}} stehen im DOM als Zahl, daher zaehlt das laengste feste Stueck.
function findTextTarget(scope: HTMLElement, text: string): HTMLElement | null {
  const wanted = text
    .split(/\{\{[^}]*\}\}|<[^>]*>/)
    .map(normalizeSearchText)
    .sort((a, b) => b.length - a.length)[0];
  if (!wanted) return null;
  let best: HTMLElement | null = null;
  let bestLength = Infinity;
  for (const el of scope.querySelectorAll<HTMLElement>('*')) {
    const raw = el.textContent ?? '';
    if (raw.length >= bestLength) continue;
    const content = normalizeSearchText(raw);
    if (!content.includes(wanted)) continue;
    best = el;
    bestLength = raw.length;
  }
  if (best instanceof HTMLOptionElement) best = best.parentElement;
  return best?.closest<HTMLElement>(ROW_SELECTOR) ?? best;
}

