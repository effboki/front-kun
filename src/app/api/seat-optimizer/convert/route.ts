

import { NextResponse } from 'next/server';
import { parseAssignmentsTsv, type ApplyJSON, type Assignment } from '@/lib/seat-optimizer/tsv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 追加の検証/修復用に、任意の文脈を受け付ける
type ReservationLite = { id: string; partySize: number };
type TableLite = { id: string; capacity: number };
type Joinable = { tables: string[]; max: number };
type PolicyLite = { joinables?: Joinable[] };
type ConvertContext = {
  reservations?: ReservationLite[];
  tables?: TableLite[];
  policy?: PolicyLite;
};

type Warning = {
  index: number; // assignments内の行番号（0-based）
  reservation_id: string;
  code: string;   // 例: SMALL_PARTY_SPLIT, OVER_ALLOCATION, DUP_TABLE, POLICY_OPTIMIZED
  message: string;
};

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }
function asIds(arr: (string | number)[] = []) { return arr.map((x) => String(x)); }
function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw: string =
      (typeof body?.raw === 'string' && body.raw) ||
      (typeof body?.tsv === 'string' && body.tsv) ||
      '';

    if (!raw.trim()) {
      return NextResponse.json({ error: 'raw TSV is required' }, { status: 400 });
    }

    // まずは基本のパース（構文・型チェックは tsv.ts に委譲）
    const { plan, errors } = parseAssignmentsTsv(raw);

    // オプション：文脈（予約人数/卓キャパなど）を与えると追加検証ができる
    const context: ConvertContext | null =
      body && typeof body.context === 'object' ? (body.context as ConvertContext) : null;
    const strict: boolean = body?.strict === true;                 // trueなら警告/エラー時に422を返す
    const autoRepair: boolean = body?.autoRepair === true;         // trueなら簡易修復を適用
    const optimizeByPolicy: boolean = body?.optimizeByPolicy === true; // trueなら方針（joinables）を使ってより良い組合せに差し替え

    const resMap = new Map<string, number>();
    context?.reservations?.forEach((r) => {
      if (r && typeof r.id === 'string' && typeof r.partySize === 'number') {
        resMap.set(r.id, r.partySize);
      }
    });
    const capMap = new Map<string, number>();
    context?.tables?.forEach((t) => {
      if (t && typeof t.id === 'string' && typeof t.capacity === 'number') {
        capMap.set(String(t.id), t.capacity);
      }
    });
    const joinables: Joinable[] = (context?.policy?.joinables || []).map((j) => ({
      tables: asIds(j.tables),
      max: Number(j.max),
    })).filter((j) => j.tables.length > 0 && j.max > 0);

    // 現在案で使っている卓の占有状況（衝突回避のため）
    const used = new Map<string, number>();
    plan.assignments.forEach((a) => a.new_tables.forEach((t) => used.set(String(t), (used.get(String(t)) || 0) + 1)));

    const warnings: Warning[] = [];
    let repaired: ApplyJSON | null = null;

    // 文脈があるときのみ、最小卓数/過剰割当ての簡易チェック＆修復を行う
    if (resMap.size || capMap.size || joinables.length > 0) {
      const newAssignments: Assignment[] = [];
      let changed = false;

      plan.assignments.forEach((origA, idx) => {
        let a: Assignment = { ...origA };
        const party = resMap.get(a.reservation_id);
        const tables = uniq(a.new_tables.map(String));
        const caps = tables.map((t) => capMap.get(String(t))).filter((n): n is number => typeof n === 'number');

        let rowChanged = false;

        // 1) new_tables の重複除去（保険）
        if (tables.length !== a.new_tables.length) {
          warnings.push({
            index: idx,
            reservation_id: a.reservation_id,
            code: 'DUP_TABLE',
            message: `new_tables に重複があります -> ${a.new_tables.join('|')} → ${tables.join('|')}`,
          });
          a.new_tables = tables;
          rowChanged = true;
        }

        // 2) 小人数（<=2）は単卓のみ（capMapがある場合）
        if (party !== undefined && party <= 2 && tables.length > 1 && caps.length === tables.length) {
          const single = tables.find((t) => (capMap.get(String(t)) ?? 0) >= party);
          if (single) {
            warnings.push({
              index: idx,
              reservation_id: a.reservation_id,
              code: 'SMALL_PARTY_SPLIT',
              message: `${party}名は単卓推奨。${tables.join('|')} → ${single}`,
            });
            if (autoRepair) {
              a = {
                ...a,
                new_tables: [single],
                reason: appendReason(a.reason, '[auto-repair] 単卓化'),
                action: a.action === 'split' ? 'move' : a.action,
              };
              rowChanged = true;
            }
          }
        }

        // 現在の容量（capMap または joinables から推測）
        const currentCapacity = (() => {
          if (caps.length === tables.length && caps.length > 0) return sum(caps);
          const j = joinables.find((g) => sameSet(g.tables, tables));
          return j ? j.max : Number.NaN;
        })();

        // 3) 過剰割当て（同じセット内で卓を減らしても収容できる場合）
        if (party !== undefined && caps.length === tables.length && tables.length > 1) {
          const pairs = tables.map((t, i) => ({ t, cap: caps[i] })).sort((a, b) => b.cap - a.cap);
          let remaining = [...tables];
          let changedLocal = false;
          for (const p of pairs) {
            const tmp = remaining.filter((x) => x !== p.t);
            const tmpSum = sum(tmp.map((x) => capMap.get(String(x)) ?? 0));
            if (tmpSum >= (party ?? Infinity)) {
              remaining = tmp;
              changedLocal = true;
            }
          }
          if (changedLocal) {
            warnings.push({
              index: idx,
              reservation_id: a.reservation_id,
              code: 'OVER_ALLOCATION',
              message: `卓数が過剰の可能性。現在:${tables.join('|')}（cap=${sum(caps)}） party=${party}`,
            });
            if (autoRepair) {
              a = {
                ...a,
                new_tables: remaining,
                reason: appendReason(a.reason, '[auto-repair] 最小卓数化'),
                action: remaining.length > 1 ? 'split' : (a.action === 'split' ? 'move' : a.action),
              };
              rowChanged = true;
            }
          }
        }

        // 4) 方針に基づく最適化（joinables）: 例 6名 → 20|21(=7) を 40|41(=10) より優先
        if (optimizeByPolicy && party !== undefined && joinables.length > 0) {
          // 利用可能（他行が使っていない）か、元々自分が使っている卓のみを使う候補に限定
          const isFreeGroup = (group: string[]) =>
            group.every((t) => used.get(t) === undefined || used.get(t) === 0 || tables.includes(t));

          // 候補：max >= party のグループで、利用可能なもの
          const candidates = joinables
            .filter((g) => g.max >= party && isFreeGroup(g.tables))
            .map((g) => ({
              tables: g.tables,
              max: g.max,
              over: g.max - party,
              count: g.tables.length,
            }));

          if (candidates.length) {
            // 現在案の指標
            const currOver =
              Number.isFinite(currentCapacity) ? Math.max(0, currentCapacity - party) :
              (caps.length === tables.length ? Math.max(0, sum(caps) - party) : Number.POSITIVE_INFINITY);
            const currCount = tables.length;

            // 最良候補を選定：over 少 → 卓数 少 → テーブルID辞書順
            candidates.sort((x, y) =>
              x.over - y.over || x.count - y.count || x.tables.join(',').localeCompare(y.tables.join(','))
            );
            const best = candidates[0];

            // 改善になるときのみ採用
            const improves = best.over < currOver || (best.over === currOver && best.count < currCount);
            const different = !sameSet(best.tables, tables);
            if (improves && different) {
              // used の占有更新
              tables.forEach((t) => used.set(t, Math.max(0, (used.get(t) || 0) - 1)));
              best.tables.forEach((t) => used.set(t, (used.get(t) || 0) + 1));

              a = {
                ...a,
                new_tables: best.tables,
                reason: appendReason(a.reason, `[policy-opt] over=${best.over} / tables=${best.count}`),
                action: best.tables.length > 1 ? 'split' : (a.action === 'split' ? 'move' : a.action),
              };
              rowChanged = true;
              warnings.push({
                index: idx,
                reservation_id: a.reservation_id,
                code: 'POLICY_OPTIMIZED',
                message: `方針に基づき ${tables.join('|')} → ${best.tables.join('|')}（over ${currOver}→${best.over}）`,
              });
            }
          }
        }

        newAssignments.push(a);
        if (rowChanged) changed = true;
      });

      if (changed) {
        repaired = { assignments: newAssignments, notes: plan.notes };
      }
    }

    const payload = {
      plan: repaired || plan,
      errors: errors.length ? errors : undefined,
      warnings: warnings.length ? warnings : undefined,
      autoRepaired: !!repaired,
      repairedPlan: repaired || undefined,
    };

    if (strict && (errors.length || warnings.length)) {
      return NextResponse.json(payload, { status: 422 });
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[SeatOptimizer TSV->JSON] unexpected error', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

function appendReason(reason: string, extra: string) {
  const r = (reason || '').trim();
  return r ? `${r} / ${extra}` : extra;
}
