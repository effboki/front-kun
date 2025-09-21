// Common time utilities (TZ-agnostic)
// NOTE: Do not create Date objects when parsing "HH:mm" — keep this purely arithmetic.

/**
 * Safely parse a time into minutes from 00:00.
 * - Accepts: "HH:mm", "H:mm", "HH", numeric-like strings, numbers, null/undefined.
 * - Returns: integer minutes (0–1439 clamp on HH:mm), or 0 for invalid inputs.
 * - Never throws.
 */
export function parseTimeToMinutes(time?: string | number | null): number {
  if (typeof time === 'number' && Number.isFinite(time)) return Math.trunc(time);
  const s = (time == null ? '' : String(time)).trim();
  if (!s) return 0;

  // Flexible match: HH[:mm]? where HH can be 0-29 (clamped later to 0-23), mm 0-59
  const m = /^([0-2]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  const hh = Math.min(23, Math.max(0, parseInt(m[1]!, 10) || 0));
  const mm = Math.min(59, Math.max(0, parseInt(m[2] ?? '0', 10) || 0));
  return hh * 60 + mm;
}

/**
 * Format minutes-as-number into "HH:mm".
 * - Accepts numbers and numeric-like values; invalid inputs become "00:00".
 * - Does not modulo 24h (26:30 なども "26:30" として許容)。
 */
export function formatMinutesToTime(mins: unknown): string {
  const n = typeof mins === 'number' ? mins : Number(mins);
  if (!Number.isFinite(n)) return '00:00';
  const total = Math.max(0, Math.trunc(n));
  const hh = Math.floor(total / 60); // 24で丸めない
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// 互換エイリアス（既存コードがこちらを参照している場合のため）
export const formatMinutesToHHmm = formatMinutesToTime;

/**
 * Given any ms timestamp, return the local 00:00 of that same calendar day (in ms).
 * Always uses the runtime's local timezone; does NOT use UTC or ISO conversion.
 */
export function startOfDayMs(ms: number): number {
  const d = new Date(Number(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/**
 * Convert an "HH:mm" (or compatible) to absolute ms on the *same* day as `dayStartMs`.
 * Internally: startOfDayMs(dayStartMs) + parseTimeToMinutes(hhmm) * 60_000
 * This avoids any UTC/ISO drift; everything is local-time arithmetic.
 */

export function startMsFromHHmmOnSameDay(dayStartMs: number, hhmm: string | number | null | undefined): number {
  const base0 = startOfDayMs(dayStartMs);
  const mins = parseTimeToMinutes(hhmm as any);
  return base0 + mins * 60_000;
}

/**
 * Convert an absolute ms timestamp to "HH:mm" on the same local day as `dayStartMs`.
 * Uses local-time arithmetic only (no UTC drift). If `startMs` falls outside the day,
 * it is wrapped within 0–23:59 for display purposes.
 */
export function msToHHmmFromDay(startMs: number, dayStartMs: number): string {
  const base0 = startOfDayMs(Number(dayStartMs));
  const diffMin = Math.floor((Number(startMs) - base0) / 60000);
  const minutesInDay = 24 * 60;
  const wrapped = ((diffMin % minutesInDay) + minutesInDay) % minutesInDay;
  return formatMinutesToTime(wrapped);
}
