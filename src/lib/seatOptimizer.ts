import type { Reservation } from '@/types';
import type { AreaDef, StoreSettingsValue, SeatOptimizerConfig } from '@/types/settings';

export type SeatOptimizerPromptBundle = {
  basePrompt: string;
  sessionPrompt?: string;
};

export type SeatOptimizerTable = {
  id: string;
  capacity?: number;
  areas?: string[];
  avoidLate?: boolean;
};

export type SeatOptimizerRequestInput = {
  reservations: Array<Reservation & { startMs?: number; endMs?: number; effectiveDurationMin?: number }>;
  tables: SeatOptimizerTable[];
  prompt: SeatOptimizerPromptBundle;
  dayStartMs: number;
};

export type SeatOptimizerAssignment = {
  reservationId: string;
  action: 'keep' | 'move' | 'split' | 'cancel';
  newTables: string[];
  reason?: string;
  confidence?: number;
};

export type SeatOptimizerParsed = {
  assignments: SeatOptimizerAssignment[];
  notes: string[];
};

const formatIsoLocal = (ms: number | undefined) => {
  if (!Number.isFinite(ms as number)) return '';
  const d = new Date(ms as number);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const escapeCell = (value: unknown): string => {
  if (value == null) return '';
  const str = String(value);
  return str.replace(/\t|\r|\n/g, ' ');
};

const joinTables = (tables: string[] | undefined) => (Array.isArray(tables) && tables.length > 0 ? tables.join('|') : '');

const buildReservationRows = (input: SeatOptimizerRequestInput) => {
  const header = [
    'reservation_id',
    'start_iso',
    'end_iso',
    'stay_min',
    'guests',
    'current_tables',
    'arrived',
    'departed',
    'locked_reason',
    'notes',
  ];

  const rows = input.reservations.map((r) => {
    const start = Number.isFinite(r.startMs as number) ? (r.startMs as number) : input.dayStartMs;
    const endCandidate = Number.isFinite(r.endMs as number)
      ? (r.endMs as number)
      : Number.isFinite(r.effectiveDurationMin as number)
        ? start + (r.effectiveDurationMin as number) * 60_000
        : undefined;
    const stayMin = Number.isFinite((r as any)?.effectiveDurationMin)
      ? Math.trunc((r as any).effectiveDurationMin)
      : undefined;
    const lockedReason = r.arrived ? 'arrived' : (r.departed ? 'departed' : '');

    return [
      escapeCell(r.id),
      escapeCell(formatIsoLocal(start)),
      escapeCell(formatIsoLocal(endCandidate)),
      escapeCell(stayMin),
      escapeCell(r.guests ?? 0),
      escapeCell(joinTables(r.tables ?? (r.table ? [r.table] : []))),
      escapeCell(r.arrived ? 'true' : 'false'),
      escapeCell(r.departed ? 'true' : 'false'),
      escapeCell(lockedReason),
      escapeCell(r.notes || r.memo || ''),
    ];
  });

  return [header, ...rows];
};

const buildTableRows = (tables: SeatOptimizerTable[]) => {
  const header = ['table_id', 'capacity', 'areas', 'avoid_late'];
  const rows = tables.map((t) => [
    escapeCell(t.id),
    escapeCell(Number.isFinite(t.capacity as number) ? Math.trunc(t.capacity as number) : ''),
    escapeCell(Array.isArray(t.areas) && t.areas.length > 0 ? t.areas.join('|') : ''),
    escapeCell(t.avoidLate ? 'true' : ''),
  ]);
  return [header, ...rows];
};

const buildPromptRows = (bundle: SeatOptimizerPromptBundle) => {
  const header = ['type', 'text'];
  const rows: string[][] = [
    ['base', escapeCell(bundle.basePrompt)],
  ];
  if (bundle.sessionPrompt) {
    rows.push(['session', escapeCell(bundle.sessionPrompt)]);
  }
  return [header, ...rows];
};

const joinTsv = (rows: string[][]) => rows.map((row) => row.join('\t')).join('\n');

export const buildSeatOptimizerRequest = (input: SeatOptimizerRequestInput): string => {
  const sections = [
    '##RESERVATIONS',
    joinTsv(buildReservationRows(input)),
    '##TABLES',
    joinTsv(buildTableRows(input.tables)),
    '##PROMPTS',
    joinTsv(buildPromptRows(input.prompt)),
  ];
  return sections.join('\n');
};

const normalizeHeader = (value: string) => value.trim().toLowerCase();

const splitMarkdownRow = (line: string): string[] => {
  const raw = line.split('|').map((part) => part.trim());
  const cells = raw.filter((_, idx) => !(idx === 0 && raw[idx] === '') && !(idx === raw.length - 1 && raw[idx] === ''));
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return [];
  return cells;
};

const parseBlock = (lines: string[]): string[][] => {
  const cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (cleaned.length === 0) return [];
  return cleaned
    .map((line) => {
      if (line.includes('\t')) {
        return line.split('\t').map((cell) => cell.trim());
      }
      if (line.includes('|')) {
        const cells = splitMarkdownRow(line);
        if (cells.length > 0) return cells;
      }
      return [line];
    })
    .filter((row) => row.length > 0);
};

const toObjects = (rows: string[][]) => {
  if (rows.length === 0) return [] as Record<string, string>[];
  const headers = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? '';
    });
    return obj;
  });
};

const stripCodeFences = (raw: string) => {
  return raw
    .replace(/```(?:tsv)?/g, '')
    .replace(/```/g, '')
    .replace(/\r/g, '');
};

export const parseSeatOptimizerResponse = (raw: string): SeatOptimizerParsed => {
  const text = stripCodeFences(raw || '');
  const lines = text.split('\n');
  const blocks: Record<string, string[]> = {};
  let current: string | null = null;

  for (const line of lines) {
    if (line.startsWith('##')) {
      current = line.replace(/^##+/, '').trim().toUpperCase();
      blocks[current] = [];
      continue;
    }
    if (!current) continue;
    blocks[current].push(line);
  }

  const assignmentRows = parseBlock(blocks.ASSIGNMENTS ?? []);
  const noteRows = parseBlock(blocks.NOTES ?? []);
  const assignments = toObjects(assignmentRows)
    .map((row): SeatOptimizerAssignment | null => {
      const id = typeof row['reservation_id'] === 'string' ? row['reservation_id'].trim() : '';
      if (!id) return null;

      const actionRaw = row['action'] || 'keep';
      const normalizedAction = actionRaw.toLowerCase();
      const action: SeatOptimizerAssignment['action'] =
        normalizedAction === 'move' || normalizedAction === 'assign' || normalizedAction === 'reassign'
          ? 'move'
          : normalizedAction === 'split'
            ? 'split'
            : normalizedAction === 'cancel'
              ? 'cancel'
              : 'keep';

      const tables = (row['new_tables'] || '')
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean);

      let reason = row['reason']?.trim() || undefined;
      if (reason && /^[\d|,\s、／\\-]+$/.test(reason)) {
        reason = undefined;
      }
      const confidenceRaw = parseFloat(row['confidence'] ?? '');
      const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : undefined;

      return { reservationId: id, action, newTables: tables, reason, confidence };
    })
    .filter((item): item is SeatOptimizerAssignment => item !== null);

  const notes = toObjects(noteRows)
    .map((row) => row['note']?.trim())
    .filter((note): note is string => !!note);

  return { assignments, notes };
};

export const deriveSeatOptimizerTables = (settings: StoreSettingsValue | undefined, dayTables?: string[]): SeatOptimizerTable[] => {
  const list = Array.isArray(dayTables) && dayTables.length > 0
    ? dayTables
    : Array.isArray(settings?.tables)
      ? settings!.tables
      : [];
  const areas: AreaDef[] = Array.isArray(settings?.areas) ? (settings!.areas as AreaDef[]) : [];
  const capacityMap = settings?.tableCapacities ?? {};
  const avoidLateSet = new Set<string>(
    Array.isArray(settings?.seatOptimizer?.tags) ? settings!.seatOptimizer!.tags! : []
  );

  return list.map((id) => {
    const areaIds = areas
      .filter((a) => Array.isArray(a.tables) && a.tables.includes(id))
      .map((a) => a.id);
    return {
      id,
      capacity: capacityMap?.[id],
      areas: areaIds.length > 0 ? areaIds : undefined,
      avoidLate: avoidLateSet.has(id),
    };
  });
};

export const mergeSeatOptimizerPrompts = (
  config: SeatOptimizerConfig | undefined,
  sessionPrompt?: string,
): SeatOptimizerPromptBundle => ({
  basePrompt: config?.basePrompt ?? '',
  sessionPrompt: sessionPrompt?.trim() ? sessionPrompt.trim() : undefined,
});
