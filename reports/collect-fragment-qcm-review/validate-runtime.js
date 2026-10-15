"use strict";
const assert = require("node:assert/strict");
const bank = require("./questions.json");
const {
  validateFragmentConfig,
} = require("../../backend/domains/collect/fragments");
let count = 0;
for (const card of bank.cards) {
  const config = validateFragmentConfig({
    enabled: true,
    required: card.fragments,
    questions: card.questions.map((q) => ({
      id: q.id,
      theme: q.theme,
      text: q.question,
      answers: q.options,
      correct_index: q.correct_answer_index,
      explanation: q.explanation,
      sources: q.sources,
    })),
  });
  assert.equal(config.questions.length, config.required);
  count += config.questions.length;
}
assert.equal(bank.cards.length, 102);
assert.equal(count, 299);
console.log("102 banques, 299 QCM compatibles avec le validateur backend.");
