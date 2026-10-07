/**
 * Ensure results carry `path|mtimeVersion`; integrations that hand the file to
 * the OS need the bare path.
 */
export function coverDiskPath(path: string): string {
  const sep = path.lastIndexOf('|');
  if (sep >= 0 && /^\d+$/.test(path.slice(sep + 1))) return path.slice(0, sep);
  return path;
}
