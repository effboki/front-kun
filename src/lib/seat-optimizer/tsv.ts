// src/lib/seat-optimizer/tsv.ts
// TSV → JSON 変換ユーティリティ（プレビュー結果をそのまま機械適用する用）
// 仕様：##ASSIGNMENTS / ##NOTES の2セクション、ASSIGNMENTSはヘッダ行つき

export type Assignment = {
  reservation_id: string;
  action: 'keep' | 'move' | 'split' | 'cancel';
  new_tables: string[]; // 半角数字のみ
  reason: string;
  confidence: number; // 0.00〜1.00
};
export type ApplyJSON = { assignments: Assignment[]; notes: string[] };

export type ParseError = {
  line: number;
  message: string;
  row?: string;
};

const EXPECTED_COLUMNS = ['reservation_id', 'action', 'new_tables', 'reason', 'confidence'] as const;

const normalizeHeaderCell = (s: string) => s.trim().toLowerCase();
const splitLines = (tsv: string) => tsv.replace(/\r\n?/g, '\n').split('\n');
const isSection = (line: string, name: 'ASSIGNMENTS' | 'NOTES') => line.trim().toUpperCase() === `##${name}`;
const isBlank = (line: string) => line.trim().length === 0;
const allDigits = (s: string) => /^[0-9]+$/.test(s);

const parseHeader = (line: string): Record<string, number> => {
  const cells = line.split('\t').map((c) => normalizeHeaderCell(c));
  const map: Record<string, number> = {};
  cells.forEach((c, idx) => {
    if (EXPECTED_COLUMNS.includes(c as any)) map[c] = idx;
  });
  for (const col of EXPECTED_COLUMNS) {
    if (!(col in map)) throw new Error(`Missing required column: ${col}`);
  }
  return map;
};

const parseNewTables = (cell: string): string[] => {
  const raw = (cell || '').trim();
  if (!raw) return [];
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
};

export function parseAssignmentsTsv(tsvRaw: string): { plan: ApplyJSON; errors: ParseError[] } {
  const lines = splitLines(tsvRaw);
  const errors: ParseError[] = [];
  let i = 0;

  while (i < lines.length && !isSection(lines[i], 'ASSIGNMENTS')) i++;
  if (i >= lines.length) {
    return {
      plan: { assignments: [], notes: [] },
      errors: [{ line: -1, message: '##ASSIGNMENTS セクションが見つかりません' }],
    };
  }
  i += 1;

  if (i >= lines.length) {
    return {
      plan: { assignments: [], notes: [] },
      errors: [{ line: -1, message: 'ASSIGNMENTS ヘッダ行が存在しません' }],
    };
  }

  let headerMap: Record<string, number>;
  try {
    headerMap = parseHeader(lines[i]);
  } catch (e: any) {
    return {
      plan: { assignments: [], notes: [] },
      errors: [{ line: i + 1, message: `ヘッダ解析エラー: ${e?.message || String(e)}`, row: lines[i] }],
    };
  }
  i += 1;

  const assignments: Assignment[] = [];

  const pickCell = (cells: string[], key: string) =>
    headerMap[key] != null ? (cells[headerMap[key]] ?? '').trim() : '';

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) continue;
    if (isSection(line, 'NOTES')) break;

    const cells = line.split('\t');
    const reservation_id = pickCell(cells, 'reservation_id');
    const action = pickCell(cells, 'action') as Assignment['action'];
    const newTablesCell = pickCell(cells, 'new_tables');
    const reason = pickCell(cells, 'reason');
    const confidenceCell = pickCell(cells, 'confidence');

    if (!reservation_id) {
      errors.push({ line: i + 1, message: 'reservation_id が空です', row: line });
      continue;
    }
    if (!['keep', 'move', 'split', 'cancel'].includes(action)) {
      errors.push({ line: i + 1, message: `action が不正です: ${action}`, row: line });
      continue;
    }

    const new_tables = parseNewTables(newTablesCell);
    if (new_tables.some((t) => !allDigits(t))) {
      errors.push({ line: i + 1, message: `new_tables に半角数字以外が含まれます: ${newTablesCell}`, row: line });
      continue;
    }

    const confidence = Number.parseFloat(confidenceCell);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      errors.push({
        line: i + 1,
        message: `confidence が 0.00〜1.00 の範囲外です: ${confidenceCell}`,
        row: line,
      });
      continue;
    }

    assignments.push({ reservation_id, action, new_tables, reason, confidence });
  }

  const notes: string[] = [];
  if (i < lines.length && isSection(lines[i], 'NOTES')) {
    i += 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (isBlank(line)) continue;
      if (line.startsWith('##')) break;
      notes.push(line.trim());
    }
  }

  return { plan: { assignments, notes }, errors };
}
