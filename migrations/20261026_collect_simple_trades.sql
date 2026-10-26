ALTER TABLE collect_trade_offers ADD COLUMN IF NOT EXISTS simple_exchange BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='collect_simple_trade_shape') THEN
    ALTER TABLE collect_trade_offers ADD CONSTRAINT collect_simple_trade_shape
      CHECK(NOT simple_exchange OR(kind='direct' AND cardinality(offered_ids)=1 AND cardinality(requested_ids)=1));
  END IF;
END $$;
