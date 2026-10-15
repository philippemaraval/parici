"use strict";
const crypto = require("node:crypto");
const requirements = require("../../../data/collect_paris_fragments_active.json");
const banks = require("../../../data/collect_paris_fragment_questions.json");
const { validateFragmentConfig } = require("./fragments");
const records = Object.entries(requirements)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, required]) => {
    const separator = key.indexOf(":");
    const config = validateFragmentConfig({
      enabled: true,
      required,
      questions: banks[key],
    });
    if (config.questions.length !== required)
      throw Error("Incomplete fragment bank: " + key);
    return {
      family: key.slice(0, separator),
      source_entity_id: key.slice(separator + 1),
      fragments_required: required,
      questions: config.questions,
    };
  });
const revision = crypto
  .createHash("sha256")
  .update(JSON.stringify(records))
  .digest("hex");
async function applyFragmentBank(client) {
  const marker = await client.query(
    "SELECT value_text FROM app_settings WHERE key='parici_fragment_bank_revision'",
  );
  if (marker.rows[0]?.value_text === revision) return;
  await client.query(
    "ALTER TABLE cards ADD COLUMN IF NOT EXISTS fragments_manual_override BOOLEAN NOT NULL DEFAULT FALSE",
  );
  // Preserve the previous wording and IDs for historical inspection. In-flight
  // games already own immutable question snapshots; player progress is untouched.
  await client.query(`CREATE TABLE IF NOT EXISTS collect_fragment_bank_archives (
    revision TEXT NOT NULL, question_id UUID NOT NULL, card_id BIGINT NOT NULL,
    question_json JSONB NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(revision,question_id))`);
  const payload = JSON.stringify(records);
  await client.query(
    `INSERT INTO collect_fragment_bank_archives(revision,question_id,card_id,question_json)
    SELECT $1,q.id,q.card_id,to_jsonb(q) FROM collect_questions q JOIN cards c ON c.id=q.card_id
    JOIN jsonb_to_recordset($2::jsonb) AS r(family text,source_entity_id text) ON c.family=r.family AND c.source_entity_id=r.source_entity_id
    WHERE NOT c.fragments_manual_override AND NOT EXISTS(SELECT 1 FROM collect_content_corrections e WHERE e.card_id=c.id)
    ON CONFLICT DO NOTHING`,
    [revision, payload],
  );
  const questions = records.flatMap((r) =>
    r.questions.map((q, position) => ({
      ...q,
      position,
      family: r.family,
      source_entity_id: r.source_entity_id,
    })),
  );
  await client.query(
    `INSERT INTO collect_questions(id,card_id,position,theme,text,answers,correct_index,explanation,sources)
    SELECT q.id,c.id,q.position,q.theme,q.text,q.answers,q.correct_index,q.explanation,q.sources
    FROM jsonb_to_recordset($1::jsonb) AS q(id uuid,family text,source_entity_id text,position integer,theme text,text text,answers jsonb,correct_index integer,explanation text,sources jsonb)
    JOIN cards c ON c.family=q.family AND c.source_entity_id=q.source_entity_id
    WHERE NOT c.fragments_manual_override AND NOT EXISTS(SELECT 1 FROM collect_content_corrections e WHERE e.card_id=c.id)
    ON CONFLICT(card_id,position) DO UPDATE SET theme=EXCLUDED.theme,text=EXCLUDED.text,
      answers=EXCLUDED.answers,correct_index=EXCLUDED.correct_index,explanation=EXCLUDED.explanation,sources=EXCLUDED.sources`,
    [JSON.stringify(questions)],
  );
  await client.query(
    `DELETE FROM collect_questions q USING cards c,jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,fragments_required integer)
    WHERE q.card_id=c.id AND c.family=r.family AND c.source_entity_id=r.source_entity_id AND q.position>=r.fragments_required
    AND NOT c.fragments_manual_override AND NOT EXISTS(SELECT 1 FROM collect_content_corrections e WHERE e.card_id=c.id)`,
    [payload],
  );
  await client.query(
    `UPDATE cards c SET fragments_enabled=TRUE,fragments_required=r.fragments_required
    FROM jsonb_to_recordset($1::jsonb) AS r(family text,source_entity_id text,fragments_required integer)
    WHERE c.family=r.family AND c.source_entity_id=r.source_entity_id
    AND NOT c.fragments_manual_override AND NOT EXISTS(SELECT 1 FROM collect_content_corrections e WHERE e.card_id=c.id)`,
    [payload],
  );
  await client.query(
    "INSERT INTO app_settings(key,value_text) VALUES('parici_fragment_bank_revision',$1) ON CONFLICT(key) DO UPDATE SET value_text=EXCLUDED.value_text",
    [revision],
  );
}
module.exports = { applyFragmentBank, revision, records };
