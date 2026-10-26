-- Keep one target per player, including their private albums.
ALTER TABLE collect_album_goals ALTER COLUMN album_id DROP NOT NULL;
ALTER TABLE collect_album_goals ADD COLUMN IF NOT EXISTS personal_album_id BIGINT
  REFERENCES collect_personal_albums(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='collect_album_goals'::regclass AND conname='collect_album_goal_one_album') THEN
    ALTER TABLE collect_album_goals ADD CONSTRAINT collect_album_goal_one_album
      CHECK ((album_id IS NOT NULL)::int + (personal_album_id IS NOT NULL)::int = 1);
  END IF;
END $$;
