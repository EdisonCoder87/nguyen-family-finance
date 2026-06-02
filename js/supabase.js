// Supabase client — replace SUPABASE_URL and SUPABASE_ANON_KEY after creating your project
// The anon key is intentionally public; RLS policies control data access.
const SUPABASE_URL      = 'https://jcbsnhtgruoagxtcdzph.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYnNuaHRncnVvYWd4dGNkenBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODYyODksImV4cCI6MjA5NTk2MjI4OX0.yP9CeRmVh0fbh8iwqA06TKWTuSaUjg-yxSTgsTb2m74';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
