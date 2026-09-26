import { useEffect, useState } from 'react';
import { playlistDiagnosticError } from '@/lib/api/debugLog';
import { runPlaylistScopeDiagnostic } from '@/features/playlist/utils/playlistScopeDiagnostic';

/** Only bundled in the temporary issue #1664 Windows diagnostic build. */
export default function PlaylistScopeDiagnosticPanel({ playlistId, serverId }: { playlistId: string; serverId: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // React Compiler set-state-in-effect rule: route identity invalidates the previous report.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReport('');
  }, [playlistId, serverId]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setCopied(false);
    setReport('');
    try {
      setReport(await runPlaylistScopeDiagnostic(serverId, playlistId, setProgress));
      setProgress('Finished. Copy the report below.');
    } catch (error) {
      setReport(JSON.stringify({ diagnostic: 'playlist-1664-scope-comparison', failed: playlistDiagnosticError(error) }, null, 2));
      setProgress('The diagnostic could not finish. Copy the error report below.');
    } finally {
      setBusy(false);
    }
  };

  return <section aria-label="Playlist diagnostics" style={{ padding: '12px 24px' }}>
    <button className="btn btn-ghost" type="button" onClick={() => void run()} disabled={busy || !serverId}>
      {busy ? 'Testing libraries…' : 'Run playlist diagnostics'}
    </button>
    <span role="status" style={{ marginLeft: 12 }}>{progress}</span>
    {report && <div style={{ marginTop: 8 }}>
      <button className="btn btn-ghost" type="button" onClick={() => void navigator.clipboard.writeText(report).then(() => setCopied(true)).catch(() => setCopied(false))}>
        {copied ? 'Copied' : 'Copy diagnostic report'}
      </button>
      <textarea aria-label="Playlist diagnostic report" readOnly value={report} rows={9} style={{ display: 'block', width: '100%', marginTop: 8 }} />
    </div>}
  </section>;
}
