import { NextResponse } from 'next/server';

const DEFAULT_MODEL = process.env.SEAT_OPTIMIZER_MODEL ?? 'gpt-4o-mini';

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

    const systemPrompt = `You are an assistant that optimizes restaurant seat assignments.
Respond only using TSV tables wrapped in sections titled ##ASSIGNMENTS and ##NOTES.
Each assignment row must contain reservation_id, action, new_tables, reason, confidence.
Use only numbers and pipe separators for table lists (e.g. 12|13).`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Store: ${storeId}\n${payload}`,
          },
        ],
      }),
    });

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

    return NextResponse.json({ raw, model: DEFAULT_MODEL, usage: data?.usage ?? null });
  } catch (err) {
    console.error('[SeatOptimizer API] unexpected error', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

