// Single-transaction categorisation — used by quick-add form

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CATEGORIES = [
  'Housing','Rent/Mortgage','Internet','Car expenses','Travel','Petrol',
  'Food - Groceries','Food - Dining Out','Personal - Grace','Clothing',
  'Health Insurance','Education - personal','Children - Education','Childcare',
  'Other Expenses','Gifts','Children stuff','Family - Phuc Gifts',
  'Children babysitting','Personal - Ed','Health - Fitness','Children money','Donation'
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Unauthorized', 401);

    const { description } = await req.json();
    if (!description?.trim()) return jsonError('Missing description');

    const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check merchant patterns first (fast path)
    const words   = description.toLowerCase().split(/\s+/);
    for (let len = Math.min(3, words.length); len >= 1; len--) {
      const keyword = words.slice(0, len).join(' ');
      const { data } = await adminDb.from('merchant_patterns')
        .select('category').eq('keyword', keyword).single();
      if (data?.category) {
        return jsonResponse({ category: data.category, confidence: 0.97, source: 'pattern' });
      }
    }

    // Claude fallback with few-shot context
    const { data: history } = await adminDb.from('transactions')
      .select('description,category')
      .not('category', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30);

    const fewShot = (history || [])
      .map((h: { description: string; category: string }) => `"${h.description}" → ${h.category}`)
      .join('\n');

    const fewShotSection = fewShot
      ? `Past categorisations for this family:\n${fewShot}\n\n`
      : '';

    const prompt = `${fewShotSection}Categorise this Australian expense into one category from: ${CATEGORIES.join(', ')}

Expense: "${description}"

Return JSON only: {"category":"...","confidence":0.0-1.0}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { category: 'Other Expenses', confidence: 0.3 };

    return jsonResponse({ ...result, source: 'claude' });

  } catch (err) {
    console.error(err);
    return jsonError(err instanceof Error ? err.message : 'Unknown error');
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function jsonResponse(body: object) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  });
}

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  });
}
