import { NextResponse } from 'next/server';
import { parseAssignmentsTsv, type Assignment } from '@/lib/seat-optimizer/tsv';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Fallback parsers & deterministic helpers ----
const partyFromReason = (text: string): number | undefined => {
  const m = (text || '').match(/(\d+)\s*名/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
};
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
};
const asIds = (arr: any[] = []) => arr.map((x) => String(x));

type Joinable = { tables: string[]; max: number };

const extractContext = (body: any, payload: string) => {
  const partyMap = new Map<string, number>();
  const capMap = new Map<string, number>();
  let joinables: Joinable[] = [];
  // 1) body.context.* を優先
  try {
    if (body && typeof body === 'object' && body.context) {
      const ctx: any = body.context;
      if (Array.isArray(ctx.reservations)) {
        for (const r of ctx.reservations) {
          if (r && typeof r.id === 'string') {
            const ps = Number(r.partySize ?? r.size ?? r.guests ?? r.pax);
            if (!Number.isNaN(ps)) partyMap.set(r.id, ps);
          }
        }
      }
      if (Array.isArray(ctx.tables)) {
        for (const t of ctx.tables) {
          const id = t?.id ?? t?.tableId ?? t?.name;
          const cap = t?.capacity ?? t?.cap ?? t?.seats;
          if (id != null && cap != null) {
            const n = Number(cap);
            if (!Number.isNaN(n)) capMap.set(String(id), n);
          }
        }
      }
      if (ctx.policy?.joinables) {
        joinables = (ctx.policy.joinables as any[])
          .map((g) => ({ tables: asIds(g.tables || []), max: Number(g.max) }))
          .filter((g) => g.tables.length > 0 && Number.isFinite(g.max));
      }
    }
  } catch {}
  // 2) payload(JSON) からの補完
  try {
    const p: any = JSON.parse(payload);
    const res = p?.reservations || p?.Reservations;
    if (Array.isArray(res)) {
      for (const r of res) {
        if (r && typeof r.id === 'string') {
          const ps = Number(r.partySize ?? r.size ?? r.guests ?? r.pax);
          if (!Number.isNaN(ps) && !partyMap.has(r.id)) partyMap.set(r.id, ps);
        }
      }
    }
    const tabs = p?.tables || p?.Tables;
    if (Array.isArray(tabs)) {
      for (const t of tabs) {
        const id = t?.id ?? t?.tableId ?? t?.name;
        const cap = t?.capacity ?? t?.cap ?? t?.seats;
        if (id != null && cap != null) {
          const n = Number(cap);
          if (!Number.isNaN(n) && !capMap.has(String(id))) capMap.set(String(id), n);
        }
      }
    }
    if (!joinables.length && p?.policy?.joinables) {
      joinables = (p.policy.joinables as any[])
        .map((g: any) => ({ tables: asIds(g.tables || []), max: Number(g.max) }))
        .filter((g) => g.tables.length > 0 && Number.isFinite(g.max));
    }
  } catch {}
  return { partyMap, capMap, joinables };
};
// ---- /helpers ----

const DEFAULT_MODEL = process.env.SEAT_OPTIMIZER_MODEL ?? 'gpt-5-mini';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = typeof body?.payload === 'string' ? body.payload : '';
    const storeId = typeof body?.storeId === 'string' ? body.storeId : 'unknown';

    const url = new URL(request.url);
    const formatParam = (url.searchParams.get('format') || request.headers.get('x-seat-optimizer-format') || '').toLowerCase();
    const FORMAT: 'tsv' | 'json' = formatParam === 'json' ? 'json' : 'tsv';

    if (!payload.trim()) {
      return NextResponse.json({ error: 'payload is required' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY ?? process.env.SEAT_OPTIMIZER_OPENAI_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }

    const systemPromptTSV = `あなたは日本の飲食店で席配置を最適化するアシスタントです。学習や予測は行いません。与えられた当日の入力だけで、配席案を返します。席効率を第一に考えて配席すること。

【厳守する前提/ハード制約】
- ダブルブッキング禁止：同一卓（結合ブロック含む）で時間重複を作らないこと。
- 定員厳守：単卓/結合の合計定員以内で割当てること。
- ロック予約は動かさない：status.arrived===true または pinned===true は action=keep とし、new_tables は現状の卓を維持すること。
- 退店は空席扱い：status.departed===true の席は即回転可能とみなし、新規割当てを許可すること。
- 会計ボタンは無視する（基準に使わない）。
- 0分回転前提（掃除バッファなし）。
- 結合/分割ルールは入力/店舗方針の記述に従う。明記がない分割/結合は提案しない。
- 同一予約は滞在中、同一の卓または同一結合ブロックを占有すること（途中で卓を変えない）。
- 入力に存在しない卓番号は使わない。new_tables には半角数字とパイプのみを用いる。
- **最小卓数の原則**：同一予約に割り当てる卓の数は**最小**にする（1卓で足りるなら1卓のみ、2卓が必要なら2卓まで）。
- **過剰割当て禁止**：必要席数に対して明らかに過剰な合計定員の組合せは避ける（余剰席=合計定員−partySize を最小化）。
- **小人数は単卓**：1〜2名は単卓（または最小卓数）だけを割り当てる。2卓以上に分けない。
- **split の意味**：実際に物理的に複数卓（結合）を使う場合のみ action=split を用いる。1〜2名では原則 split しない。
- **一貫性**：action・new_tables・reason の内容は整合させる（例：reasonで「単卓」と書いたのに new_tables が2卓になる等の矛盾は不可）。

【ソフト目標（優先順位）】
1) 団体ブロックの温存：店舗方針で示された団体用の島（例：31–35、36–38、41–44等）を小組で埋めない。
2) 将来の収容力の温存：方針にある時間帯ペナルティ（例：40番台の早い時間は避ける）を反映。
3) **余剰席の最小化 → 卓数の最小化 → 変更最小** の順に評価（同点なら近接移動を優先）。
4) 断片化の回避：大きなブロック内に中途半端な穴時間を作らない。
5) 小人数の卓数削減：未到着で複数卓を使っている場合は move を優先し、必ず最小卓数にまとめる。

【入力の読み方】
- payload には Store 方針（団体可ブロック、結合可能グループ/上限、時間帯ペナルティ等）、Tables 一覧、Reservations 一覧（id, partySize, startMs, endMs, assigned[], status.arrived, status.departed, pinned）が含まれる。
- 方針の記述は箇条書き文でもよいが、**結合可能なペア/グループと最大収容**は必ず解釈して用いる（例：20|21 は最大7名、20|21|22|23|24 は最大18名 等）。
- これらのフィールドが無い場合は、無いものとして扱い、違反を生まない範囲で keep を優先する。

【選択ルール（重要）】
- 候補の組合せに対し、(A)余剰席（合計定員−partySize）が最小、(B)卓数が最小、(C)団体ブロック温存/時間ペナ、(D)変更最小、の順に決定。
- 例：6名なら 20|21(=7) や 25|26(=10) が空いている場合、40|41(=10) よりも 20|21(=7) を優先（余剰3&lt;4）。1名は必ず単卓（カウンター等）で 2卓には分けない。

【出力フォーマット（厳格）】
1. 返答は **TSV（タブ区切り）** のみ。**Markdownやコードブロックは使わない**。
2. 見出しは **##ASSIGNMENTS** と **##NOTES** の2つのみ。
3. ##ASSIGNMENTS は以下の列名/順序でヘッダ行を含む：
   reservation_id	action	new_tables	reason	confidence
   - action は {keep|move|split|cancel} のいずれか。
   - new_tables は卓番号をパイプ区切り（例: 12|13）。半角数字とパイプのみ。**重複禁止**。**必要最小個数**にする。
   - reason は日本語の短文。**選定根拠（例：「6名→20|21(計7) 余剰1のため」）を必ず含める**。
   - confidence は 0.00〜1.00 の小数（2桁）で自己評価。
   - 基本は **全予約を1行ずつ** 出力する（固定は keep、再割当は move/split）。
4. ##NOTES には補足があれば日本語で記載。無ければ空行でもよい。

【自己検証/フォールバック】
- 出力前に各行について自己検証：合計定員 ≥ partySize、余剰席/卓数が上記規則に反していないか、action・new_tables・reason の整合が取れているか。
- どうしても可行解が作れない予約は action=keep とし、##NOTES に「NEEDS_MANUAL: 理由（空き/結合不可/方針違反）」を列挙。
- 入力が不完全で判断できない場合は、**全件 keep** とし、その理由を ##NOTES に明記する。

以上を厳守して返答してください。`;

    const systemPromptJSON = `あなたは日本の飲食店で席配置を最適化するアシスタントです。学習や予測は行いません。与えられた当日の入力だけで、配席案を返します。席効率を第一に考えて配席すること。

【ハード制約／ソフト目標／入力の読み方】はTSV版と同一。厳守事項も同一です（最小卓数原則・過剰割当て禁止・余剰席最小化・一貫性チェックを含む）。

【出力フォーマット（厳格にJSONのみ）】
返答は **純粋なJSON文字列** のみ。コードブロック・TSV・Markdownは一切禁止。構造は下記スキーマに**完全一致**させます。

{
  "assignments": [
    {
      "reservation_id": "string",
      "action": "keep" | "move" | "split" | "cancel",
      "new_tables": [ "12", "13" ],
      "reason": "日本語の短文（例：6名→20|21(計7) 余剰1のため）",
      "confidence": 0.00
    }
  ],
  "notes": [ "NEEDS_MANUAL: 理由...", "..." ]
}

- new_tables は半角数字のみ。**必要最小卓数**で、**重複禁止**。結合は最小卓数に限定。
- 1〜2名では split を用いない。1卓で割当てる。
- 全予約を assignments に1行ずつ含める（固定は keep）。
- 返答は上記JSON以外の文字を一切含めないこと。`;

    const repairPromptTSV = `あなたは席配置案の**検証・修正専用アシスタント**です。入力として「店舗方針＋テーブル一覧＋予約一覧（payload）」と、LLMが提案した**候補TSV**（##ASSIGNMENTS/##NOTESの2セクション、ヘッダ: reservation_id  action  new_tables  reason  confidence）が与えられます。

目的：候補案の**矛盾や非効率**を最小限の修正で正し、**同じTSVフォーマット**で出力すること。

【必ず満たすルール】
- **最小卓数**：必要なら1卓、次に2卓…と**使う卓数を最小化**する。1〜2名は**単卓のみ**（split禁止）。
- **余剰席最小化**：合計定員−partySize を最小にする。次に卓数最小、次に変更最小。
- **過剰割当て禁止**：必要人数に対し明らかに大きすぎる組合せは禁止（例：1名で2卓、6名で10席×2卓など）。
- **方針尊重**：payloadの結合ルール/上限（例：20|21=7名、20|21|22|23|24=18名、25|26=10名、30|31=9名、30|31|33=14名、40|41=10名、42|43=10名…）を守る。明記されない結合は作らない。
- **自己整合性**：action・new_tables・reason を整合させる（例：「単卓」と書いたのに new_tables が2卓は不可）。
- **重複禁止/表記**：new_tables は半角数字とパイプのみ、重複禁止、**必要最小個数**。
- **可行性**：ダブルブッキングや定員超過は禁止（payloadの assigned を尊重）。

【選好の例】
- 6名：20|21(=7) が可用なら最優先。次点は25|26(=10)や40|41(=10)だが、**余剰の少ない方**を優先。
- 1名：必ず単卓（カウンター等）に**1卓のみ**。

【入出力】
- 入力に CANDIDATE_TSV が与えられる。矛盾や非効率が無ければ**そのまま再出力**してよい。
- 出力は **TSVのみ**。Markdown/コードブロックは使わない。
- セクションは ##ASSIGNMENTS と ##NOTES の二つのみ。ASSIGNMENTS は既定のヘッダ行を含める。
`;

    const messages = [
      { role: 'system', content: FORMAT === 'json' ? systemPromptJSON : systemPromptTSV },
      { role: 'user', content: `Store: ${storeId}\n${payload}` },
    ];

    const requestBody: any = {
      model: DEFAULT_MODEL,
      messages,
    };
    if (FORMAT === 'json') {
      requestBody.response_format = { type: 'json_object' } as const;
    }
    if (String(DEFAULT_MODEL).startsWith('gpt-5')) {
      requestBody.max_completion_tokens = 2000;
    } else {
      requestBody.max_tokens = 2000;
    }

    // GPT-5 系は temperature が未対応の場合があるため送信を避ける
    if (!String(DEFAULT_MODEL).startsWith('gpt-5')) {
      requestBody.temperature = 0.0;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SeatOptimizer API] OpenAI error', response.status, errorText);
      return NextResponse.json({ error: 'Failed to call OpenAI', detail: errorText }, { status: 502 });
    }

    const data = await response.json();

    const raw =
      typeof data?.choices?.[0]?.message?.content === 'string'
        ? data.choices[0].message.content
        : Array.isArray(data?.choices?.[0]?.message?.content)
          ? data.choices[0].message.content.map((item: any) => item?.text ?? '').join('\n')
          : '';

    if (!raw.trim()) {
      return NextResponse.json({ error: 'OpenAI response was empty' }, { status: 502 });
    }

    // --- Second pass: validator/repair for TSV to fix contradictions & enforce minimal tables ---
    let finalRaw = raw;
    if (FORMAT === 'tsv') {
      const repairMessages = [
        { role: 'system', content: repairPromptTSV },
        { role: 'user', content: `Store: ${storeId}\n${payload}\n\nCANDIDATE_TSV:\n${raw}` },
      ];
      const repairBody: any = {
        model: DEFAULT_MODEL,
        max_tokens: 1200,
        messages: repairMessages,
      };
      if (!String(DEFAULT_MODEL).startsWith('gpt-5')) {
        repairBody.temperature = 0.0;
      }
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 25_000);
      try {
        const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(repairBody),
          signal: controller2.signal,
        });
        clearTimeout(timeout2);
        if (resp2.ok) {
          const data2 = await resp2.json();
          const repaired =
            typeof data2?.choices?.[0]?.message?.content === 'string'
              ? data2.choices[0].message.content
              : Array.isArray(data2?.choices?.[0]?.message?.content)
                ? data2.choices[0].message.content.map((item: any) => item?.text ?? '').join('\n')
                : '';
          if (repaired && repaired.trim().startsWith('##ASSIGNMENTS')) {
            finalRaw = repaired;
          }
        } else {
          // if repair fails, keep original raw
          console.warn('[SeatOptimizer API] repair pass skipped due to non-OK status:', resp2.status);
        }
      } catch (e) {
        console.warn('[SeatOptimizer API] repair pass error, using original TSV', e);
      } finally {
        clearTimeout(timeout2);
      }
    }

    // --- Deterministic optimize pass: small-party single-table & joinables preference ---
    try {
      if (FORMAT === 'tsv' && finalRaw && finalRaw.trim().startsWith('##ASSIGNMENTS')) {
        const { partyMap, capMap, joinables } = extractContext(body, payload);
        const { plan } = parseAssignmentsTsv(finalRaw);

        // 現在案で使われている卓（衝突を避けるための簡易占有マップ）
        const used = new Map<string, number>();
        plan.assignments.forEach((a) => {
          a.new_tables.forEach((t) => {
            used.set(String(t), (used.get(String(t)) || 0) + 1);
          });
        });

        let changed = false;

        const fixed = plan.assignments.map((orig): Assignment => {
          let a: Assignment = { ...orig };
          const tables = uniq(a.new_tables.map(String));
          if (tables.length !== a.new_tables.length) {
            a.new_tables = tables;
            a.reason = a.reason ? `${a.reason} / [server-repair] 重複卓除去` : '[server-repair] 重複卓除去';
            changed = true;
          }

          // 人数の取得：context → payload(JSON) → reason の "(\d+)名"
          const psKnown = partyMap.get(a.reservation_id);
          const ps = psKnown !== undefined ? psKnown : partyFromReason(a.reason);

          // 1) 1–2名は必ず単卓（split禁止）
          if (ps !== undefined && ps <= 2 && a.new_tables.length > 1) {
            a.new_tables = [a.new_tables[0]];
            a.action = a.action === 'split' || a.action === 'keep' ? 'move' : a.action;
            a.reason = a.reason ? `${a.reason} / [server-repair] 1-2名は単卓化` : '[server-repair] 1-2名は単卓化';
            changed = true;
            return a;
          }

          // 2) joinables に基づく最適化（余剰→卓数の順で改善する場合のみ）
          if (ps !== undefined && joinables.length) {
            const currCount = a.new_tables.length;
            const currCap = sum(a.new_tables.map((t) => capMap.get(String(t)) ?? Number.NaN));
            const currOver = Number.isFinite(currCap) ? Math.max(0, currCap - ps) : Number.POSITIVE_INFINITY;
            const isFreeGroup = (group: string[]) =>
              group.every((t) => (used.get(t) ?? 0) - (tables.includes(t) ? 1 : 0) <= 0);

            const candidates = joinables
              .filter((g) => g.max >= ps && isFreeGroup(g.tables))
              .map((g) => ({ tables: g.tables, max: g.max, over: g.max - ps, count: g.tables.length }));

            if (candidates.length) {
              candidates.sort(
                (x, y) => x.over - y.over || x.count - y.count || x.tables.join(',').localeCompare(y.tables.join(','))
              );
              const best = candidates[0];
              const different = !sameSet(best.tables, tables);
              const improves = best.over < currOver || (best.over === currOver && best.count < currCount);
              if (different && improves) {
                // used の占有更新
                tables.forEach((t) => used.set(t, Math.max(0, (used.get(t) || 0) - 1)));
                best.tables.forEach((t) => used.set(t, (used.get(t) || 0) + 1));

                a.new_tables = best.tables;
                a.action = best.tables.length > 1 ? 'split' : (a.action === 'split' ? 'move' : a.action);
                a.reason = a.reason
                  ? `${a.reason} / [policy-opt] over=${best.over} tables=${best.count}`
                  : `[policy-opt] over=${best.over} tables=${best.count}`;
                changed = true;
              }
            }
          }

          return a;
        });

        if (changed) {
          const header = 'reservation_id\taction\tnew_tables\treason\tconfidence';
          const rows = fixed.map((r) =>
            [r.reservation_id, r.action, r.new_tables.join('|'), r.reason, (typeof r.confidence === 'number' ? r.confidence : 0).toFixed(2)].join('\t')
          );
          const notes = (plan.notes && plan.notes.length > 0) ? plan.notes.join('\n') : '';
          finalRaw = `##ASSIGNMENTS\n${header}\n${rows.join('\n')}\n##NOTES\n${notes}`.trim();
        }
      }
    } catch (e) {
      console.warn('[SeatOptimizer API] deterministic optimize skipped:', e);
    }

    if (FORMAT === 'json') {
      try {
        const json = JSON.parse(raw);
        return NextResponse.json({ format: 'json', json, model: DEFAULT_MODEL, usage: data?.usage ?? null });
      } catch (e) {
        console.error('[SeatOptimizer API] JSON parse failed, returning raw', e);
        return NextResponse.json({ format: 'json', error: 'Failed to parse JSON from model', raw, model: DEFAULT_MODEL, usage: data?.usage ?? null }, { status: 502 });
      }
    } else {
      return NextResponse.json({ format: 'tsv', raw: finalRaw, model: DEFAULT_MODEL, usage: data?.usage ?? null });
    }
  } catch (err) {
    console.error('[SeatOptimizer API] unexpected error', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
