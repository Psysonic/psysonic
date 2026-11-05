import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, Radio, X } from 'lucide-react';
import type { InternetRadioStation } from '@/lib/api/subsonicTypes';
import { CoverArtImage } from '@/cover/CoverArtImage';
import { radioCoverRef } from '@/cover/ref';
import ServerSelect, { type ServerSelectOption } from '@/ui/ServerSelect';

interface RadioEditModalProps {
  station: InternetRadioStation | null; // null = create new
  initialServerId: string;
  serverOptions: ServerSelectOption[];
  onClose: () => void;
  onSave: (opts: {
    serverId: string;
    name: string;
    streamUrl: string;
    homepageUrl: string;
    coverFile: File | null;
    coverRemoved: boolean;
  }) => Promise<void>;
}

export default function RadioEditModal({
  station,
  initialServerId,
  serverOptions,
  onClose,
  onSave,
}: RadioEditModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(station?.name ?? '');
  const [streamUrl, setStreamUrl] = useState(station?.streamUrl ?? '');
  const [homepageUrl, setHomepageUrl] = useState(station?.homepageUrl ?? '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestedServerId, setRequestedServerId] = useState(initialServerId);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const serverId = serverOptions.some(server => server.id === requestedServerId)
    ? requestedServerId
    : serverOptions[0]?.id ?? '';

  const hasExistingCover = !coverRemoved && (coverPreview || station?.coverArt);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverFile(file);
    setCoverRemoved(false);
    const reader = new FileReader();
    reader.onload = ev => setCoverPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemoveCover = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCoverFile(null);
    setCoverPreview(null);
    setCoverRemoved(true);
  };

  const handleSave = async () => {
    if (!serverId || !name.trim() || !streamUrl.trim()) return;
    setSaving(true);
    try {
      await onSave({ serverId, name, streamUrl, homepageUrl, coverFile, coverRemoved });
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* Portal to document.body: nested .content-body uses contain:paint — in-tree
   * modals are clipped when the station list is empty (short layout). Same pattern as RadioDirectoryModal. */
  return createPortal(
    <div
      className="modal-overlay"
      style={{ alignItems: 'center', paddingTop: 0, overflowY: 'auto' }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="modal-content"
        style={{ maxWidth: 440, width: '90%', maxHeight: 'none', overflow: 'visible' }}
        onClick={e => e.stopPropagation()}
      >
        <button className="btn btn-ghost modal-close" onClick={onClose} aria-label={t('common.close')} style={{ top: 16, right: 16 }}>
          <X size={18} />
        </button>

        <h2 id={titleId} className="modal-title" style={{ fontSize: 20 }}>
          {station ? t('radio.editStation') : t('radio.addStation')}
        </h2>

        {/* Cover + fields side by side */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
          {/* Cover */}
          <div
            className="playlist-edit-cover-wrap"
            style={{ width: 140, height: 140 }}
            onClick={() => coverInputRef.current?.click()}
          >
            {coverPreview ? (
              <img src={coverPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : !coverRemoved && station?.coverArt ? (
              <CoverArtImage
                coverRef={radioCoverRef(station)}
                displayCssPx={140}
                surface="sparse"
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div className="album-card-cover-placeholder playlist-card-icon" style={{ width: '100%', height: '100%', borderRadius: 0 }}>
                <Radio size={36} strokeWidth={1.2} />
              </div>
            )}
            <div className="playlist-edit-cover-overlay">
              <div className="playlist-edit-cover-menu">
                <button
                  className="playlist-edit-cover-menu-item"
                  onClick={e => { e.stopPropagation(); coverInputRef.current?.click(); }}
                >
                  <Camera size={13} />
                  {t('radio.changeCoverLabel')}
                </button>
                {hasExistingCover && (
                  <button
                    className="playlist-edit-cover-menu-item playlist-edit-cover-menu-item--danger"
                    onClick={handleRemoveCover}
                  >
                    {t('radio.removeCover')}
                  </button>
                )}
              </div>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>

          {/* Fields */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!station && (
              <ServerSelect
                value={serverId}
                options={serverOptions}
                onChange={setRequestedServerId}
                disabled={saving}
                style={{ width: '100%' }}
              />
            )}
            <input
              className="input"
              style={{ fontSize: 15, fontWeight: 600 }}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('radio.stationName')}
              aria-label={t('radio.stationName')}
              autoFocus
            />
            <input
              className="input"
              value={streamUrl}
              onChange={e => setStreamUrl(e.target.value)}
              placeholder={t('radio.streamUrl')}
              aria-label={t('radio.streamUrl')}
            />
            <input
              className="input"
              value={homepageUrl}
              onChange={e => setHomepageUrl(e.target.value)}
              placeholder={t('radio.homepageUrl')}
              aria-label={t('radio.homepageUrl')}
            />
          </div>
        </div>

        <div className="playlist-edit-footer">
          <div />
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !serverId || !name.trim() || !streamUrl.trim()}
          >
            {saving ? <Loader2 size={14} className="spin-slow" /> : null}
            {t('radio.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
