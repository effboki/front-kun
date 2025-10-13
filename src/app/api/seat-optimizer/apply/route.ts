import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = process.env.SEAT_OPTIMIZER_MODEL ?? 'gpt-4o-mini';

type Assignment = {
  reservation_id: string;
  action: 'keep' | 'move' | 'split' | 'cancel';
  new_tables: string[];
  reason: string;
  confidence: number;
};

type ApplyJSON = { assignments: Assignment[]; notes: string[] };

const isValidApplyJSON = (input: unknown): input is ApplyJSON => {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.assignments) || !Array.isArray(candidate.notes)) return false;

  for (const a of candidate.assignments) {
    if (!a || typeof a !== 'object') return false;
    const row = a as Record<string, unknown>;
    if (typeof row.reservation_id !== 'string') return false;
    if (!['keep', 'move', 'split', 'cancel'].includes(row.action as string)) return false;
    if (!Array.isArray(row.new_tables)) return false;
    if (
      row.new_tables.some(
        (t) => typeof t !== 'string' || !/^[0-9]+$/.test(t),
      )
    ) {
      return false;
    }
    if (typeof row.reason !== 'string') return false;
    if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1) return false;
  }

  if (candidate.notes.some((n: unknown) => typeof n !== 'string')) return false;
  return true;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = typeof body?.payload === 'string' ? body.payload : '';
    const storeId = typeof body?.storeId === 'string' ? body.storeId : 'unknown';

    if (!payload.trim()) {
      return NextResponse.json({ error: 'payload is required' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY ?? process.env.SEAT_OPTIMIZER_OPENAI_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured' }, { status: 500 });
    }

    const systemPromptJSON = `あなたは日本の飲食店で席配置を最適化するアシスタントです。学習や予測は行いません。与えられた当日の入力だけで配席案を返します。席効率を第一に考えて配席すること。
【ハード制約／ソフト目標／入力の読み方】は preview(TSV) と同一。厳守事項も同一です。
【出力フォーマット（厳格にJSONのみ）】
返答は純粋なJSON文字列のみ。構造は下記スキーマに完全一致させます。
{
  "assignments": [
    {
      "reservation_id": "string",
      "action": "keep" | "move" | "split" | "cancel",
      "new_tables": [ "12", "13" ],
      "reason": "日本語の短文",
      "confidence": 0.00
    }
  ],
  "notes": [ "NEEDS_MANUAL: 理由...", "..." ]
}
- new_tables は半角数字のみ。複数なら配列。結合は必要最小卓数。
- 全予約を assignments に1行ずつ含める（固定は keep）。
- 返答は上記JSON以外の文字を一切含めないこと。`;

    const messages = [
      { role: 'system', content: systemPromptJSON },
      { role: 'user', content: `Store: ${storeId}\n${payload}` },
    ];

    const requestBody: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      max_tokens: 2000,
      messages,
      response_format: { type: 'json_object' },
    };

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
      console.error('[SeatOptimizer APPLY] OpenAI error', response.status, errorText);
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

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.error('[SeatOptimizer APPLY] JSON parse failed', error, raw);
      return NextResponse.json({ error: 'Invalid JSON returned from model', raw }, { status: 502 });
    }

    if (!isValidApplyJSON(json)) {
      return NextResponse.json({ error: 'JSON does not match schema', json }, { status: 422 });
    }

    return NextResponse.json({ plan: json, model: DEFAULT_MODEL, usage: data?.usage ?? null });
  } catch (err) {
    console.error('[SeatOptimizer APPLY] unexpected error', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
