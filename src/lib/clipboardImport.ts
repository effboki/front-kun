'use client';

export type ImportedReservation = {
  startAtMs: number;
  name: string;
  people: number;
  table?: string;
  tables?: string[];
  course?: string;
  notes?: string;
};

export type ColumnMapping = {
  startAt?: number;
  name?: number;
  people?: number;
  table?: number;
  course?: number;
  notes?: number[];
};

function normalizeNotesValue(value: any): number[] | undefined {
  if (value == null) return undefined;
  const list = (Array.isArray(value) ? value : [value])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
  if (list.length === 0) return undefined;
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const n of list) {
    if (!seen.has(n)) {
      seen.add(n);
      unique.push(n);
    }
  }
  return unique;
}

function normalizeMappingShape(mapping: any): ColumnMapping | null {
  if (!mapping) return null;
  const next: ColumnMapping = { ...mapping };
  const notes = normalizeNotesValue((mapping as any).notes);
  if (notes && notes.length > 0) {
    next.notes = notes;
  } else {
    delete (next as any).notes;
  }
  return next;
}

type ParseOptions = {
  dayStartMs: number;
  storeId: string;
  preferMapping?: boolean;
  mappingOverride?: ColumnMapping | null;
  dedupe?: boolean; // reserved for future use when we add dedupe support
};

type ParseResult = {
  rows: ImportedReservation[];
  headers: string[] | null;
  mappingUsed: ColumnMapping | null;
  skipped: number;
  warnings: string[];
  needMapping: boolean;
  previewRows: string[][];
};

const HEADER_SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  startAt: ['start', 'startat', '開始', '開始時刻', '開始時間', 'start time', 'time'],
  name: ['name', '氏名', 'お名前', '予約名', '代表者', 'customer'],
  people: ['people', '人数', 'pax', 'guests', 'guest', '名'],
  table: ['table', '卓', '席', 'table no', 't-'],
  course: ['course', 'コース', 'plan', 'プラン'],
  notes: ['notes', 'メモ', '備考', 'remark', 'note'],
};

export function parseClipboardText(text: string, opts: ParseOptions): ParseResult {
  const { dayStartMs, storeId, preferMapping = true, mappingOverride } = opts;
  const baseline = clampToDayStart(dayStartMs);
  const normalizedText = (text ?? '').replace(/\r\n?/g, '\n');
  const trimmed = normalizedText.trim();
  if (!trimmed) {
    return {
      rows: [],
      headers: null,
      mappingUsed: null,
      skipped: 0,
      warnings: ['空の入力です'],
      needMapping: true,
      previewRows: [],
    };
  }

  const lines = normalizedText.split('\n').filter((line, idx) => line.length > 0 || idx === 0);
  const sniffLines = lines.slice(0, 5);
  let tabCount = 0;
  let commaCount = 0;
  for (const line of sniffLines) {
    tabCount += (line.match(/\t/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }
  let mode: 'tsv' | 'csv' | 'space' = 'space';
  if (tabCount >= commaCount && tabCount > 0) {
    mode = 'tsv';
  } else if (commaCount > tabCount) {
    mode = 'csv';
  }

  const cellRows = lines.map((line) => splitLine(line, mode));
  const maybeHeaders = detectHeader(cellRows[0]) ? cellRows[0].map((s) => s.trim()) : null;
  const dataRows = maybeHeaders ? cellRows.slice(1) : cellRows;

  const storedMapping = preferMapping ? loadMapping(storeId) : null;
  const mapping = normalizeMappingShape(
    mappingOverride ??
      storedMapping ??
      (maybeHeaders ? autoMapFromHeaders(maybeHeaders) : null)
  );

  const needMapping = !isMappingSatisfied(mapping);
  const warnings: string[] = [];
  const rows: ImportedReservation[] = [];
  let skipped = 0;

  for (const cells of dataRows) {
    const parsed = toImportedReservation(cells, mapping, baseline);
    if (parsed) {
      rows.push(parsed);
    } else {
      skipped += 1;
    }
  }

  if (rows.length === 0 && skipped > 0) {
    warnings.push('有効な行を読み取れませんでした');
  }
  if (!needMapping && rows.length === 0) {
    warnings.push('必須列を含む行が見つかりませんでした');
  }

  return {
    rows,
    headers: maybeHeaders,
    mappingUsed: mapping ?? null,
    skipped,
    warnings,
    needMapping,
    previewRows: dataRows.slice(0, 50),
  };
}

export function saveMapping(storeId: string, mapping: ColumnMapping): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizeMappingShape(mapping);
    if (normalized) {
      window.localStorage.setItem(mappingKey(storeId), JSON.stringify(normalized));
    }
  } catch (error) {
    console.warn('[clipboardImport] failed to save mapping', error);
  }
}

export function loadMapping(storeId: string): ColumnMapping | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(mappingKey(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeMappingShape(parsed);
  } catch (error) {
    console.warn('[clipboardImport] failed to parse mapping', error);
    return null;
  }
}

function mappingKey(storeId: string): string {
  return `frontkun-import-mapping:${storeId}`;
}

function splitLine(line: string, mode: 'tsv' | 'csv' | 'space'): string[] {
  if (mode === 'tsv') {
    return line.split('\t');
  }
  if (mode === 'csv') {
    return parseCsvLine(line);
  }
  return line.trim().split(/\s+/);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function detectHeader(firstRow: string[] | undefined): boolean {
  if (!firstRow || firstRow.length === 0) return false;
  const joined = firstRow.join(' ').toLowerCase();
  return ['start', 'time', '開始', 'name', '氏名', '人数', 'people', 'pax', '卓', 'table', 'コース', 'course', 'メモ', 'notes'].some(
    (keyword) => joined.includes(keyword)
  );
}

function autoMapFromHeaders(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowered = headers.map((h) => h.trim().toLowerCase());
  for (const key of Object.keys(HEADER_SYNONYMS) as (keyof ColumnMapping)[]) {
    const synonyms = HEADER_SYNONYMS[key];
    const index = lowered.findIndex((header) => synonyms.some((syn) => header.startsWith(syn)));
    if (index >= 0) {
      if (key === 'notes') {
        mapping.notes = [index];
      } else {
        (mapping as any)[key] = index;
      }
    }
  }
  return mapping;
}

function isMappingSatisfied(mapping: ColumnMapping | null | undefined): mapping is ColumnMapping {
  if (!mapping) return false;
  return mapping.startAt != null && mapping.name != null && mapping.people != null;
}

function toImportedReservation(
  cells: string[],
  mapping: ColumnMapping | null,
  dayStartMs: number,
): ImportedReservation | null {
  if (!cells || cells.length === 0) return null;

  const pickValue = (index: number | number[] | undefined): string => {
    if (index == null) return '';
    if (Array.isArray(index)) {
      const parts = index
        .map((i) => (cells[i] ?? '').trim())
        .filter(Boolean);
      return parts.join(' ');
    }
    return (cells[index] ?? '').trim();
  };

  const startRaw = pickValue(mapping?.startAt ?? 0);
  const nameRaw = pickValue(mapping?.name ?? 1);
  const peopleRaw = pickValue(mapping?.people ?? 2);
  const tableRaw = pickValue(mapping?.table);
  const courseRaw = pickValue(mapping?.course);
  const notesRaw = Array.isArray(mapping?.notes) && mapping.notes.length > 0
    ? mapping.notes
        .map((idx) => (cells[idx] ?? '').trim())
        .filter(Boolean)
        .join('\n\n')
    : '';

  if (!startRaw && !nameRaw && !peopleRaw) return null;

  const startAtMs = parseTimeFlexible(startRaw, dayStartMs);
  const people = parsePeople(peopleRaw);

  if (startAtMs == null || people == null) return null;
  if (!nameRaw) return null;

  const tables = parseTables(tableRaw);
  const table = tables[0] ?? null;

  return {
    startAtMs,
    name: nameRaw,
    people,
    table: table ?? undefined,
    tables: tables.length > 1 ? tables : table ? [table] : undefined,
    course: courseRaw || undefined,
    notes: notesRaw || undefined,
  };
}

export function parseTimeFlexible(input: string, dayStartMs: number): number | null {
  const value = (input ?? '').trim();
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d, hh, mm] = isoMatch;
    const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0);
    return dt.getTime();
  }

  const hmMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hmMatch) {
    const [, hh, mm] = hmMatch;
    return dayStartMs + (Number(hh) * 60 + Number(mm)) * 60_000;
  }

  const hhmmMatch = value.match(/^(\d{1,2})(\d{2})$/);
  if (hhmmMatch) {
    const [, hh, mm] = hhmmMatch;
    return dayStartMs + (Number(hh) * 60 + Number(mm)) * 60_000;
  }

  const jpMatch = value.match(/^(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分)?$/);
  if (jpMatch) {
    const [, hh, mm] = jpMatch;
    const minutes = Number(hh) * 60 + Number(mm ?? 0);
    return dayStartMs + minutes * 60_000;
  }

  const ampmMatch = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] ?? 0);
    const suffix = ampmMatch[3].toLowerCase();
    if (suffix === 'pm' && hours < 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    return dayStartMs + (hours * 60 + minutes) * 60_000;
  }

  return null;
}

export function parsePeople(input: string): number | null {
  const match = String(input ?? '').match(/(\d{1,3})/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value;
}

function parseTables(input: string): string[] {
  const matches = String(input ?? '').match(/\d{1,3}/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of matches) {
    const num = String(Number(raw));
    if (!num) continue;
    if (seen.has(num)) continue;
    seen.add(num);
    list.push(num);
  }
  return list;
}

function clampToDayStart(value: number): number {
  const dt = new Date(value);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).getTime();
}

export { HEADER_SYNONYMS };
