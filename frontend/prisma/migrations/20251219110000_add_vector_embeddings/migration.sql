-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to store text embeddings (OpenAI 1536-dim)
ALTER TABLE "Experiment"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Optional: IVFFlat index for faster similarity search (requires rows > 1000 for best results)
-- You can rebuild with a different lists value based on dataset size.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'experiment_embedding_idx'
  ) THEN
    CREATE INDEX experiment_embedding_idx ON "Experiment" USING ivfflat ("embedding") WITH (lists = 100);
  END IF;
END
$$;
