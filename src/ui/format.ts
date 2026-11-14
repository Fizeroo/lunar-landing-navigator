/** Display-only formatting. No astronomy here; inputs come from the science module. */

/** "2026-11-05T14:31:40.250Z" -> "2026-11-05 14:32 UTC" (rounded to the minute). */
export function formatUtcMinute(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return 'invalid UTC';
  const rounded = new Date(Math.round(ms / 60000) * 60000).toISOString();
  return `${rounded.slice(0, 10)} ${rounded.slice(11, 16)} UTC`;
}

/** "2026-11-05T14:31:40.250Z" -> "2026-11-05T14:31:40Z" (whole seconds, explicit Z). */
export function formatUtcSecond(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return `${new Date(Math.round(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

/** Approximate duration, e.g. "≈ 6 d 13 h", "≈ 5 h 12 min", "≈ 12 min", "none". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'none';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `≈ ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes - hours * 60;
    return rest ? `≈ ${hours} h ${rest} min` : `≈ ${hours} h`;
  }
  const totalHours = Math.round(seconds / 3600);
  const days = Math.floor(totalHours / 24);
  const restHours = totalHours - days * 24;
  return restHours ? `≈ ${days} d ${restHours} h` : `≈ ${days} d`;
}

/** Fraction 0..1 -> "62.1%". */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;
}

/** Signed degrees with a true minus sign, e.g. "+1.23°", "−0.50°". */
export function formatSignedDeg(value: number, digits = 2): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return `${text}°`;
  return `${value < 0 ? '−' : '+'}${text}°`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;

/** Azimuth (north = 0°, east = 90°) -> 16-point compass name. */
export function compassPoint(azDeg: number): string {
  const index = ((Math.round(azDeg / 22.5) % 16) + 16) % 16;
  return COMPASS[index] ?? 'N';
}

/** "89.6700° S, 129.7800° E" — planetocentric latitude, east-positive longitude. */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(4)}° ${latDeg < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(lonDeg).toFixed(4)}° ${lonDeg < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}
