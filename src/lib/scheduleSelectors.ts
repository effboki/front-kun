import type { ScheduleItem } from '@/types/schedule';
import type { CourseDef } from '@/types/settings';
import { snap5m, markConflicts } from '@/lib/schedule';

/** 'HH:mm'（または 'H:mm' / '26:00' のような24超えも許可）を、dayStartMs の“同一カレンダー日”基準でms化。
 *  - dayStartMs の時刻より小さいHHの場合は翌日扱い（例: dayStart=17時 で '01:30' → 翌日1:30）
 */
function hhmmToMsFromDay(hhmm: string, dayStartMs: number): number {
  const base = new Date(dayStartMs);
  const baseHour = base.getHours();
  let h = 0, m = 0;
  if (typeof hhmm === 'string') {
    const parts = hhmm.split(':');
    if (parts.length >= 1) h = Math.floor(Number(parts[0]));
    if (parts.length >= 2) m = Math.floor(Number(parts[1]));
  }
  if (!Number.isFinite(h)) h = 0;
  if (!Number.isFinite(m)) m = 0;

  // 24超えを許容（26:00 → 翌日2:00 相当）
  let hourForSet = h;
  if (h < 24 && h < baseHour) {
    // 24未満かつベース時刻より小さい -> 翌日扱い
    hourForSet = h + 24;
  }
  const d = new Date(base);
  d.setHours(hourForSet, m, 0, 0); // setHours は 24超えを翌日に繰り上げてくれる
  return d.getTime();
}

/** コース名から滞在分数を取得（未設定は120分） */
export function getStayMinutes(courseName: string | undefined | null, courses?: CourseDef[]): number {
  const DEFAULT_STAY = 120;
  if (!courseName || !Array.isArray(courses)) return DEFAULT_STAY;
  const found = courses.find(c => c.name === courseName);
  const v = found?.stayMinutes;
  return Number.isFinite(v as number) && (v as number)! > 0 ? (v as number)! : DEFAULT_STAY;
}

/** 予約データの多様な形を吸収して startMs を算出（dayStartMs を基準に 'HH:mm' を解決） */
function resolveStartMs(resv: any, dayStartMs: number): number {
  const asNum = (v: any): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const asDateMs = (v: any): number | undefined => {
    if (!v) return undefined;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : undefined;
    }
    return undefined;
  };

  // 1) 既に数値の startMs
  const direct = asNum(resv.startMs);
  if (typeof direct === 'number') return direct;

  // 2) 'HH:mm' 文字列 + dayStartMs
  const timeStr: unknown = resv.time ?? resv.arrivalTime ?? resv.startTime ?? resv.hhmm;
  if (typeof timeStr === 'string' && timeStr.length >= 3) {
    return hhmmToMsFromDay(timeStr, dayStartMs);
  }

  // 3) ISO/Date っぽい文字列やDateオブジェクト
  const parsed = asDateMs(resv.startAt) ?? asDateMs(resv.start) ?? asDateMs(resv.arrivalAt);
  if (typeof parsed === 'number') return parsed;

  // 4) フォールバック：その日の開始（dayStartMs）
  return dayStartMs;
}

/** tables フィールドを配列の string[] に正規化（重複除去・順序維持・レガシー対応） */
function resolveTables(resv: any): string[] {
  const addMany = (acc: any[], v: any) => {
    if (v == null) return acc;
    if (Array.isArray(v)) return acc.concat(v);
    if (typeof v === 'string') return acc.concat(v.split(',').map(s => s.trim()).filter(Boolean));
    return acc.concat([v]);
  };

  let raw: any[] = [];
  raw = addMany(raw, resv.tables);
  raw = addMany(raw, resv.tableIds);
  raw = addMany(raw, resv.table_id);
  raw = addMany(raw, resv.tableId);
  raw = addMany(raw, resv.table);

  // 文字列化・トリム・空除去
  const mapped = raw.map(x => String(x).trim()).filter(Boolean);

  // 重複除去（最初の出現順を保持）
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of mapped) {
    if (!seen.has(t)) {
      seen.add(t);
      uniq.push(t);
    }
  }
  return uniq;
}

/** 真偽っぽい値を boolean に */
function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.some(toBool);
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (!normalized) return false;
    if (['false', '0', 'no', 'なし', '無', 'なしです'].includes(normalized)) return false;
    return true;
  }
  return false;
}

/** 任意の予約行を ScheduleItem に正規化 */
export function mapReservationToScheduleItem(resv: any, dayStartMs: number, courses?: CourseDef[]): ScheduleItem {
  const start = snap5m(resolveStartMs(resv, dayStartMs));

  // 終了計算の優先順位に従う
  const endExplicit: number | undefined = (typeof resv.endMs === 'number' && Number.isFinite(resv.endMs)) ? resv.endMs : undefined;

  let end: number | undefined = endExplicit;
  if (end == null) {
    const dur = (typeof resv.durationMin === 'number' && resv.durationMin > 0) ? resv.durationMin : undefined;
    if (dur) end = start + dur * 60 * 1000;
  }
  if (end == null) {
    const courseName: string | undefined = resv.course ?? resv.courseName ?? resv.plan ?? undefined;
    let courseStay: number | undefined;
    if (courseName && Array.isArray(courses)) {
      const found = courses.find(c => c.name === courseName);
      if (found && typeof found.stayMinutes === 'number' && found.stayMinutes > 0) courseStay = Math.floor(found.stayMinutes);
    }
    const stayMinutes = (typeof resv.stayMinutes === 'number' && resv.stayMinutes > 0)
      ? Math.floor(resv.stayMinutes)
      : (courseStay ?? 120);
    end = start + stayMinutes * 60 * 1000;
  }

  const courseName: string | undefined = resv.course ?? resv.courseName ?? resv.plan ?? undefined;

  const name: string =
    resv.name ?? resv.guestName ?? resv.customerName ?? resv.clientName ?? '—';
  const people: number =
    resv.people ?? resv.guests ?? resv.partySize ?? resv.persons ?? 0;

  const normalizeLabel = (value: any): string => {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(normalizeLabel).filter(Boolean).join(',');
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return String(value ?? '').trim();
  };

  const drinkLabel = normalizeLabel(resv.drinkLabel ?? resv.drinkPlanName ?? resv.drinkOption ?? resv.drink);
  const eatLabel = normalizeLabel(resv.eatLabel ?? resv.eatPlanName ?? resv.eatOption ?? resv.eat);

  const drink = drinkLabel ? true : toBool(resv.drink ?? resv.drinkPlan ?? resv.hasDrink);
  const eat = eatLabel ? true : toBool(resv.eat ?? resv.buffet ?? resv.hasEat);

  const arrived = toBool(resv.arrived);
  const paid = toBool(resv.paid);
  const departed = toBool(resv.departed);

  const memoRaw = typeof resv.memo === 'string' ? resv.memo.trim() : undefined;
  const notesRaw = typeof resv.notes === 'string' ? resv.notes.trim() : undefined;
  const combinedNotes = (notesRaw ?? memoRaw ?? '').trim();

  return {
    id: String(resv.id ?? resv.reservationId ?? resv._id ?? cryptoRandomId()),
    name,
    people: Number(people) || 0,
    course: courseName,
    drink,
    eat,
    drinkLabel: drinkLabel || undefined,
    eatLabel: eatLabel || undefined,
    tables: resolveTables(resv),
    startMs: start,
    endMs: end,
    status: 'normal',
    arrived,
    paid,
    departed,
    notes: combinedNotes || undefined,
    memo: memoRaw ?? (combinedNotes || undefined),
  };
}

/** visibleTables に1つでも含まれるものだけ通す */
function filterByVisibleTables(items: ScheduleItem[], visibleTables?: string[]): ScheduleItem[] {
  if (!visibleTables || visibleTables.length === 0) return items;
  const set = new Set(visibleTables.map(String));
  return items.filter(it => it.tables.some(t => set.has(String(t))));
}

/** 予約配列 → スケジュール表示用に正規化して競合マーキングまで行う */
export function selectScheduleItems(
  reservations: any[] | undefined,
  courses: CourseDef[] | undefined,
  visibleTables?: string[],
  dayStartMs?: number,
): ScheduleItem[] {
  if (!Array.isArray(reservations) || reservations.length === 0) return [];

  // dayStartMs は呼び出し元から渡される想定（未指定時のみ最小限の保険）
  const startOfDayLocal = (ms: number) => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };
  const anchorMs = typeof dayStartMs === 'number' ? dayStartMs : startOfDayLocal(Date.now());

  // 1) Reservation -> ScheduleItem（絶対ms）
  const mapped = reservations
    .map(r => mapReservationToScheduleItem(r, anchorMs, courses))
    .filter((it): it is ScheduleItem => Number.isFinite(it.startMs) && Number.isFinite(it.endMs));

  // 2) visibleTables が指定されている場合は主卓（tables[0] もしくは legacy table）でフィルタ
  const vis = new Set((visibleTables ?? []).map(String));
  const filtered = vis.size > 0
    ? mapped.filter(it => {
        const primary = Array.isArray(it.tables) && it.tables.length > 0 ? it.tables[0] : (it as any).table;
        return !primary || vis.has(String(primary));
      })
    : mapped;

  // 3) 絶対msのままスナップ（各アイテムの start/end を 5分に丸める）→ 被りマーキング
  const snapped = filtered.map(it => ({
    ...it,
    startMs: snap5m(it.startMs),
    endMs: snap5m(it.endMs),
  }));
  const marked = markConflicts(snapped);

  return marked;
}

/** 乱数ID（予約にIDが無い場合の一時用） */
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  // 乱数簡易フォールバック
  return 'tmp_' + Math.random().toString(36).slice(2, 10);
}
