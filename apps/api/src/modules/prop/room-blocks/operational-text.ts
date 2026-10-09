/** NFR-SEC-03: operational free text is not a storage channel for guest identifiers. */
export function maskOperationalText(value: string): string {
  return value
    .replace(
      /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu,
      (match) => `****${match.slice(-4)}`,
    )
    .replace(/\+?\d[\d\s().-]*\d/gu, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 9 ? `****${digits.slice(-4)}` : match;
    });
}
