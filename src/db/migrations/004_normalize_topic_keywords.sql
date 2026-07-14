-- Sprint B: strip legacy sentence-length keywords from topics (see normalizeKeywords).
UPDATE topics SET keywords = COALESCE(
  (SELECT array_agg(kw) FROM (
     SELECT DISTINCT kw FROM unnest(keywords) AS kw
     WHERE length(kw) <= 40
       AND array_length(regexp_split_to_array(trim(kw), '\s+'), 1) <= 4
  ) filtered),
  '{}'
)
WHERE EXISTS (
  SELECT 1 FROM unnest(keywords) AS kw
  WHERE length(kw) > 40
     OR array_length(regexp_split_to_array(trim(kw), '\s+'), 1) > 4
);
