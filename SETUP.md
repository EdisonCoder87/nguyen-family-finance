# Setup Guide — Nguyen Family Finance

## Step 1 — Create Supabase project

1. Go to https://supabase.com → New project → name it `nguyen-family-finance`
2. Choose region: **Australia Southeast (Sydney)**
3. Save your password somewhere safe
4. Wait ~2 min for it to spin up

## Step 2 — Run the database schema

1. In Supabase dashboard → **SQL Editor** → New query
2. Paste the contents of `supabase/migrations/001_init.sql`
3. Click **Run** — you should see "Success"

## Step 3 — Create storage bucket

1. Supabase dashboard → **Storage** → New bucket
2. Name: `statements`
3. Public: **OFF** (private, requires auth)
4. Click Create

## Step 4 — Add your Supabase credentials to the frontend

Open `js/supabase.js` and replace:
- `YOUR_SUPABASE_URL` → your project URL (e.g. `https://abcdefg.supabase.co`)
- `YOUR_SUPABASE_ANON_KEY` → your anon/public key

Both are in Supabase → Settings → API.

## Step 5 — Create user accounts

1. Supabase dashboard → **Authentication** → Users → Invite user
2. Create Edison: `edison.newwin@gmail.com`
3. Create Grace: grace's email address
4. Both will receive an email to set their password

## Step 6 — Deploy Edge Functions

Install the Supabase CLI (one-time):
```
npm install -g supabase
```

Then in `C:\family-finance`:
```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy parse-statement
supabase functions deploy categorize
```

Your project ref is the part of your URL before `.supabase.co`.

## Step 7 — Deploy to GitHub Pages

1. Create a new GitHub repo: `nguyen-family-finance` (private)
2. In `C:\family-finance`:
```
git remote add origin https://github.com/EdisonCoder87/nguyen-family-finance.git
git push -u origin main
```
3. GitHub repo → Settings → Pages → Source: **Deploy from branch** → main → / (root)
4. Your site will be live at: `https://edisonCoder87.github.io/nguyen-family-finance`

## Step 8 — Import historical data (2024–2025)

```
set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
set SUPABASE_SERVICE_KEY=your-service-role-key
set EDISON_USER_ID=your-uuid-from-auth-table
python scripts/migrate.py
```

The Edison user ID is in Supabase → Authentication → Users → click Edison → copy UUID.

---

## Ongoing use

- **Add expense on the go**: tap the + button (bottom right) on any page
- **Upload CC statement**: Upload page → select bank → drop file → review → confirm
- **Download all transactions**: Transactions page → Download CSV
- **Download original files**: Files page → Download button per file
- **Mark recurring**: click 🔄 on any transaction in the transactions list

## Cost reminder

Everything runs on free tiers. The only cost is ~$0.05/month on Anthropic API for AI categorisation.
Free→paid trigger: Supabase Storage fills 1GB (years away at current volume).
