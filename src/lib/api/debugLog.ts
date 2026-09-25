/**
 * Tiny typed facade over the generated `frontend_debug_log` command — a
 * best-effort debug sink (Settings → Logging → Debug → Rust log buffer) used
 * from a handful of instrumentation helpers across the app. The command is
 * `Result`-wrapped, so the generated binding would leak a rejection to an
 * unhandled promise on a fire-and-forget call; the `.catch` swallows it,
 * matching the prior `void invoke(...).catch(() => {})` call sites. Calls that
 * omit `depth` remain level 1 for backward compatibility.
 */
import { commands } from '@/generated/bindings';
import {
  isDebugLoggingDepthEnabled,
  type DebugLoggingDepth,
} from '@/lib/perf/debugLoggingMode';

export function frontendDebugLog(
  scope: string,
  message: string,
  depth: DebugLoggingDepth = 1,
): void {
  if (!isDebugLoggingDepthEnabled(depth)) return;
  void commands.frontendDebugLog(scope, message).catch(() => {});
}

/** Temporary #1664 diagnostic build: only structured, non-identifying fields reach PsyLab. */
export function playlistDiagnosticLog(event: string, details: Record<string, string | number | boolean | null>): void {
  if (import.meta.env.VITE_ISSUE_1664_DIAGNOSTICS !== '1') return;
  frontendDebugLog('playlist-1664', JSON.stringify({ event, ...details }));
}

export function playlistDiagnosticError(error: unknown): Record<string, string | number | boolean | null> {
  if (!error || typeof error !== 'object') return { errorType: 'unknown', httpStatus: null, networkCode: null };
  const candidate = error as { response?: { status?: unknown }; code?: unknown; name?: unknown };
  const status = candidate.response?.status;
  const code = candidate.code;
  return {
    errorType: typeof candidate.name === 'string' && /^(AxiosError|Error|TypeError)$/.test(candidate.name)
      ? candidate.name : 'other',
    httpStatus: typeof status === 'number' ? status : null,
    networkCode: typeof code === 'string' && /^(ECONNABORTED|ETIMEDOUT|ERR_NETWORK|ERR_CANCELED)$/.test(code)
      ? code : null,
  };
}
