-- Helper RPC: increment merchant pattern confirmation count
CREATE OR REPLACE FUNCTION increment_pattern_count(p_keyword TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE merchant_patterns
  SET confirmation_count = confirmation_count + 1,
      last_seen = NOW()
  WHERE keyword = p_keyword;
END;
$$;
