"""
One-time migration: imports 2024-2025 rows from the Nguyen Family Cash Expenses Excel
into the Supabase transactions table.

Usage:
  pip install openpyxl requests python-dotenv
  python scripts/migrate.py
"""

import openpyxl
import requests
import json
import os
from datetime import datetime

# ---- CONFIG — fill these in ----
SUPABASE_URL      = os.environ.get('SUPABASE_URL',      'YOUR_SUPABASE_URL')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'YOUR_SUPABASE_ANON_KEY')
SERVICE_ROLE_KEY  = os.environ.get('SUPABASE_SERVICE_KEY', 'YOUR_SERVICE_ROLE_KEY')
EXCEL_PATH        = r'C:\Users\Miksta\Downloads\Bubs Rakoon SIA Nguyen Family Cash Expenses.xlsx'
# The user_id to assign these transactions to (Edison's user ID from Supabase Auth)
EDISON_USER_ID    = os.environ.get('EDISON_USER_ID', 'YOUR_EDISON_USER_ID')

HEADERS = {
    'apikey':        SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal'
}

VALID_CATEGORIES = {
    'Housing', 'Rent/Mortgage', 'Internet', 'Car expenses', 'Travel', 'Petrol',
    'Food - Groceries', 'Food - Dining Out', 'Personal - Grace', 'Clothing',
    'Health Insurance', 'Education - personal', 'Children - Education', 'Childcare',
    'Other Expenses', 'Gifts', 'Children stuff', 'Family - Phuc Gifts',
    'Children babysitting', 'Personal - Ed', 'Health - Fitness', 'Children money', 'Donation'
}


def load_sheet(path: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['2025']
    rows = []
    last_date = None

    for row in ws.iter_rows(min_row=2, values_only=True):
        date_val, desc, amount, category = row[0], row[1], row[2], row[3]

        # Carry forward last known date (spreadsheet sometimes leaves date blank)
        if date_val and isinstance(date_val, datetime):
            last_date = date_val.date().isoformat()

        if not desc or not amount:
            continue

        try:
            amount_float = float(amount)
        except (TypeError, ValueError):
            continue

        if amount_float <= 0:
            continue

        category_clean = None
        if category and str(category).strip() in VALID_CATEGORIES:
            category_clean = str(category).strip()

        rows.append({
            'user_id':     EDISON_USER_ID,
            'date':        last_date or '2024-01-01',
            'description': str(desc).strip(),
            'amount':      round(amount_float, 2),
            'category':    category_clean,
            'source_bank': 'excel',
            'is_recurring': False
        })

    print(f'Loaded {len(rows)} rows from spreadsheet')
    return rows


def batch_insert(rows: list[dict], batch_size: int = 100):
    url = f'{SUPABASE_URL}/rest/v1/transactions'
    inserted = 0
    skipped  = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        res   = requests.post(url, headers=HEADERS, data=json.dumps(batch))
        if res.status_code in (200, 201):
            inserted += len(batch)
            print(f'  Inserted rows {i+1}–{i+len(batch)}')
        else:
            print(f'  ERROR on batch {i}: {res.status_code} {res.text[:200]}')
            skipped += len(batch)

    print(f'\nDone. Inserted: {inserted}, Skipped: {skipped}')
    return inserted


def seed_merchant_patterns(rows: list[dict]):
    """Build merchant patterns from confirmed (categorised) rows."""
    pattern_counts: dict[str, dict] = {}

    for row in rows:
        if not row.get('category'):
            continue
        words   = row['description'].lower().split()
        keyword = ' '.join(words[:min(3, len(words))])
        cat     = row['category']

        if keyword not in pattern_counts:
            pattern_counts[keyword] = {'category': cat, 'count': 0}
        if pattern_counts[keyword]['category'] == cat:
            pattern_counts[keyword]['count'] += 1

    # Only seed patterns confirmed 2+ times
    patterns = [
        {
            'keyword':            kw,
            'category':           v['category'],
            'confirmation_count': v['count'],
            'last_seen':          datetime.utcnow().isoformat()
        }
        for kw, v in pattern_counts.items()
        if v['count'] >= 2
    ]

    if not patterns:
        print('No patterns to seed.')
        return

    url = f'{SUPABASE_URL}/rest/v1/merchant_patterns'
    headers = {**HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal'}
    res = requests.post(url, headers=headers, data=json.dumps(patterns))
    if res.status_code in (200, 201):
        print(f'Seeded {len(patterns)} merchant patterns')
    else:
        print(f'Pattern seed error: {res.status_code} {res.text[:200]}')


if __name__ == '__main__':
    if 'YOUR_SUPABASE_URL' in SUPABASE_URL:
        print('ERROR: Set SUPABASE_URL, SUPABASE_SERVICE_KEY, and EDISON_USER_ID before running.')
        print('  export SUPABASE_URL=https://xxx.supabase.co')
        print('  export SUPABASE_SERVICE_KEY=your-service-role-key')
        print('  export EDISON_USER_ID=your-user-uuid')
        exit(1)

    print('=== Nguyen Family Finance — Data Migration ===\n')
    rows = load_sheet(EXCEL_PATH)

    print(f'\nInserting {len(rows)} transactions into Supabase…')
    inserted = batch_insert(rows)

    if inserted > 0:
        print('\nSeeding merchant patterns from categorised rows…')
        seed_merchant_patterns(rows)

    print('\nMigration complete!')
