import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

const CATEGORIES = [
  'Housing','Rent/Mortgage','Internet','Car expenses','Travel','Petrol',
  'Food - Groceries','Food - Dining Out','Personal - Grace','Clothing',
  'Health Insurance','Education - personal','Children - Education','Childcare',
  'Other Expenses','Gifts','Children stuff','Family - Phuc Gifts',
  'Children babysitting','Personal - Ed','Health - Fitness','Children money','Donation'
];

interface Transaction {
  date: string;
  description: string;
  amount: number;
  source_bank?: string;
  file_id?: string;
  category?: string;
  confidence?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Unauthorized', 401);

    const { storage_path, bank, file_id } = await req.json();
    if (!storage_path) return jsonError('Missing storage_path');

    // Use service role to download from storage
    const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: fileData, error: dlErr } = await adminDb.storage
      .from('statements')
      .download(storage_path);
    if (dlErr) return jsonError('Could not download file: ' + dlErr.message);

    const filename = storage_path.split('/').pop() || '';
    const ext      = filename.split('.').pop()?.toLowerCase();

    let rawTransactions: Transaction[] = [];
    let detectedBank = bank || 'unknown';

    if (ext === 'pdf') {
      rawTransactions = await parsePDF(fileData, bank);
      detectedBank = rawTransactions[0]?.source_bank || 'pdf';
    } else if (ext === 'xlsx' || ext === 'xls') {
      rawTransactions = await parseExcel(fileData, bank);
      detectedBank = 'excel';
    } else {
      const text = await fileData.text();
      const resolvedBank = (bank && bank !== 'auto') ? bank : detectCSVBank(text.trim().split('\n')[0]);
      rawTransactions = parseCSV(text, resolvedBank);
      detectedBank = resolvedBank;
    }

    if (!rawTransactions.length) return jsonError('No transactions found in file');

    // Fetch merchant patterns for fast pre-matching
    const { data: patterns } = await adminDb.from('merchant_patterns').select('keyword,category');
    const patternMap = new Map<string, string>();
    (patterns || []).forEach((p: { keyword: string; category: string }) =>
      patternMap.set(p.keyword.toLowerCase(), p.category)
    );

    // Pre-match from patterns
    const toAI: Transaction[]      = [];
    const preMatched: Transaction[] = [];

    for (const t of rawTransactions) {
      const words   = t.description.toLowerCase().split(/\s+/);
      let matched   = false;
      // Try 3-word, 2-word, 1-word keyword match
      for (let len = Math.min(3, words.length); len >= 1; len--) {
        const key = words.slice(0, len).join(' ');
        if (patternMap.has(key)) {
          preMatched.push({ ...t, category: patternMap.get(key), confidence: 0.97, file_id });
          matched = true;
          break;
        }
      }
      if (!matched) toAI.push({ ...t, file_id });
    }

    // Fetch last 50 confirmed transactions for few-shot context
    const userDb = createClient(SUPABASE_URL, authHeader.replace('Bearer ', '') ? SUPABASE_URL : SUPABASE_SERVICE_KEY);
    const { data: history } = await adminDb.from('transactions')
      .select('description,category')
      .not('category', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    const fewShot = (history || [])
      .map((h: { description: string; category: string }) => `"${h.description}" → ${h.category}`)
      .join('\n');

    // Batch AI categorisation for unmatched transactions
    let aiResults: { category: string; confidence: number }[] = [];
    if (toAI.length > 0) {
      aiResults = await categoriseWithClaude(
        toAI.map(t => t.description),
        fewShot
      );
    }

    // Merge results
    const aiTransactions = toAI.map((t, i) => ({
      ...t,
      category:   aiResults[i]?.category   || null,
      confidence: aiResults[i]?.confidence ?? 0.5
    }));

    const allTransactions = [...preMatched, ...aiTransactions];

    return new Response(
      JSON.stringify({ transactions: allTransactions, detected_bank: detectedBank }),
      { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error(err);
    return jsonError(err instanceof Error ? err.message : 'Unknown error');
  }
});

// ---- CSV PARSERS ----

function parseCSV(text: string, bank: string): Transaction[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  if (bank === 'amex') return parseAMEX(lines);
  else if (bank === 'cba_credit') return parseCBACredit(lines);
  else if (bank === 'cba_bank') return parseCBABank(lines);
  else if (bank === 'hsbc') return parseHSBC(lines);
  else if (bank === 'citibank') return parseCitibank(lines);
  else return parseGenericCSV(lines);
}

function csvRow(line: string): string[] {
  const res: string[] = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  res.push(cur.trim());
  return res;
}

function toDate(s: string): string {
  // Handle DD/MM/YYYY and YYYY-MM-DD and other formats
  s = s.replace(/"/g, '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m}-${d}`;
  }
  return s;
}

function parseCBACredit(lines: string[]): Transaction[] {
  // Date, Description, Debit, Credit, Balance
  const txns: Transaction[] = [];
  for (const line of lines.slice(1)) {
    const cols = csvRow(line);
    if (cols.length < 3) continue;
    const debit = parseFloat(cols[2] || '0');
    if (!debit || isNaN(debit)) continue;
    txns.push({ date: toDate(cols[0]), description: cols[1], amount: Math.abs(debit), source_bank: 'cba_credit' });
  }
  return txns;
}

function parseCBABank(lines: string[]): Transaction[] {
  // Date, Amount, Description, Balance
  const txns: Transaction[] = [];
  for (const line of lines.slice(1)) {
    const cols = csvRow(line);
    if (cols.length < 3) continue;
    const amount = parseFloat(cols[1]);
    if (isNaN(amount) || amount >= 0) continue; // only debits (negative)
    txns.push({ date: toDate(cols[0]), description: cols[2], amount: Math.abs(amount), source_bank: 'cba_bank' });
  }
  return txns;
}

function parseAMEX(lines: string[]): Transaction[] {
  const headerCols = csvRow(lines[0]).map(h => h.toLowerCase().replace(/"/g, '').trim());
  const dateIdx = headerCols.findIndex(h => h === 'date');
  const descIdx = headerCols.findIndex(h => h.includes('description'));
  const amtIdx  = headerCols.findIndex(h => h === 'amount');
  if (dateIdx < 0 || amtIdx < 0) return [];

  const txns: Transaction[] = [];
  for (const line of lines.slice(1)) {
    const cols = csvRow(line);
    const amount = parseFloat(cols[amtIdx]);
    if (isNaN(amount) || amount <= 0) continue; // positive = purchase; negative = payment/credit
    const desc = (descIdx >= 0 ? cols[descIdx] : cols[dateIdx + 1] || 'Unknown').trim();
    txns.push({ date: toDate(cols[dateIdx]), description: desc, amount, source_bank: 'amex' });
  }
  return txns;
}

function parseHSBC(lines: string[]): Transaction[] {
  // Various HSBC formats — try to detect date/amount/description
  return parseGenericCSV(lines, 'hsbc');
}

function parseCitibank(lines: string[]): Transaction[] {
  return parseGenericCSV(lines, 'citibank');
}

function parseGenericCSV(lines: string[], sourceBank = 'csv'): Transaction[] {
  const header = csvRow(lines[0]).map(h => h.toLowerCase().replace(/"/g, ''));
  const dateIdx = header.findIndex(h => h.includes('date'));
  const descIdx = header.findIndex(h => h.includes('desc') || h.includes('narr') || h.includes('particulars') || h.includes('detail') || h.includes('what'));
  const amtIdx  = header.findIndex(h => h === 'amount' || h === 'debit' || h === 'withdrawal');

  if (dateIdx < 0 || amtIdx < 0) return [];

  const txns: Transaction[] = [];
  for (const line of lines.slice(1)) {
    const cols = csvRow(line);
    const amount = parseFloat(cols[amtIdx]);
    if (isNaN(amount) || amount === 0) continue;
    txns.push({
      date:        toDate(cols[dateIdx] || ''),
      description: cols[descIdx >= 0 ? descIdx : dateIdx+1] || 'Unknown',
      amount:      Math.abs(amount),
      source_bank: sourceBank
    });
  }
  return txns;
}

function detectCSVBank(firstLine: string): string {
  const h = firstLine.toLowerCase();
  if (h.includes('date processed') || h.includes('card member') || h.includes('account #')) return 'amex';
  if (h.includes('transaction date') && h.includes('debit')) return 'cba_credit';
  if (h.includes('date') && h.includes('amount') && !h.includes('debit') && !h.includes('description')) return 'cba_bank';
  return 'generic';
}

// ---- EXCEL PARSER ----

async function parseExcel(fileData: Blob, bank: string): Promise<Transaction[]> {
  // Use sheetjs via CDN
  const XLSX = await import('https://esm.sh/xlsx@0.18.5');
  const buffer = await fileData.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length < 2) return [];

  const header = (rows[0] as (string | null)[]).map(h => String(h || '').toLowerCase().trim());
  const dateIdx = header.findIndex(h => h.includes('date'));
  const descIdx = header.findIndex(h => h.includes('what') || h.includes('desc') || h.includes('item'));
  const amtIdx  = header.findIndex(h => h.includes('amount') || h.includes('amt'));

  if (dateIdx < 0 || descIdx < 0 || amtIdx < 0) return [];

  const txns: Transaction[] = [];
  for (const row of rows.slice(1)) {
    const desc   = String(row[descIdx] || '').trim();
    const raw    = row[amtIdx];
    const amount = typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
    if (!desc || isNaN(amount) || amount <= 0) continue;

    // Handle Excel date serial numbers
    let dateStr = '';
    const rawDate = row[dateIdx];
    if (typeof rawDate === 'number') {
      const d = XLSX.SSF.parse_date_code(rawDate);
      dateStr = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } else {
      dateStr = toDate(String(rawDate || ''));
    }

    txns.push({ date: dateStr, description: desc, amount, source_bank: 'excel' });
  }
  return txns;
}

// ---- PDF PARSER (via Claude vision) ----

async function parsePDF(fileData: Blob, bank: string): Promise<Transaction[]> {
  const buffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  const base64 = btoa(binary);

  const prompt = `Extract all debit/expense transactions from this bank statement PDF.
Identify the bank or card issuer name from the statement header (e.g. "Bank of Melbourne", "Citibank", "28 Degrees", "AMEX", "CBA").
Return ONLY a JSON object with this exact structure:
{"bank": "Bank of Melbourne", "transactions": [{"date": "YYYY-MM-DD", "description": "string", "amount": 1.23}]}
Ignore credits, refunds, payments, opening/closing balances, and header rows. Amounts must be positive numbers.
Return only the JSON object, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const obj = JSON.parse(match[0]);
    const detectedPdfBank: string = obj.bank || bank || 'pdf';
    const txnsArray: { date: string; description: string; amount: number }[] =
      Array.isArray(obj) ? obj : (obj.transactions || []);
    return txnsArray.map(t => ({ ...t, source_bank: detectedPdfBank }));
  } catch {
    return [];
  }
}

// ---- CLAUDE CATEGORISATION ----

async function categoriseWithClaude(
  descriptions: string[],
  fewShot: string
): Promise<{ category: string; confidence: number }[]> {
  const catList = CATEGORIES.join(', ');

  const fewShotSection = fewShot
    ? `\nPast confirmed categorisations for this family (use these as guidance):\n${fewShot}\n`
    : '';

  const prompt = `You are a financial categorisation assistant for an Australian family.
Categorise each transaction description into exactly one of these categories:
${catList}

${fewShotSection}
Use your knowledge of Australian merchants, restaurants, and services.
Return ONLY a JSON array with one object per description in the same order:
[{"category":"Food - Groceries","confidence":0.95}, ...]

Confidence: 0.0 to 1.0. Use 0.95+ for obvious matches, 0.6-0.84 for uncertain.

Descriptions to categorise:
${descriptions.map((d, i) => `${i+1}. ${d}`).join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';
  try {
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : descriptions.map(() => ({ category: 'Other Expenses', confidence: 0.3 }));
  } catch {
    return descriptions.map(() => ({ category: 'Other Expenses', confidence: 0.3 }));
  }
}

// ---- HELPERS ----

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function jsonError(msg: string, status = 400) {
  return new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
  );
}
