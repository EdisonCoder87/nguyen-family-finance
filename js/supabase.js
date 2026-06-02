// Supabase client — replace SUPABASE_URL and SUPABASE_ANON_KEY after creating your project
// The anon key is intentionally public; RLS policies control data access.
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
