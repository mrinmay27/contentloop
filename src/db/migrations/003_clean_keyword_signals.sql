-- Sprint B: remove sentence-length keyword labels that predate normalizeKeywords.
DELETE FROM learning_signals WHERE signal_type = 'keyword' AND length(label) > 40;
