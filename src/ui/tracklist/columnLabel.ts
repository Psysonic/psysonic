/** Translation key of a column label: a bare key lives in `albumDetail`, a dotted one is used as is. */
export function columnLabelKey(i18nKey: string): string {
  return i18nKey.includes('.') ? i18nKey : `albumDetail.${i18nKey}`;
}
