ALTER TABLE media ADD COLUMN ai_disclosure TEXT
  CHECK (ai_disclosure IN ('ai-edited', 'ai-generated'));
