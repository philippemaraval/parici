"use strict";
const { randomUUID } = require("node:crypto");
function validateFragmentConfig(config) {
  const invalid = () => {
    throw Object.assign(
      new Error(
        "Configuration de fragments invalide : choisissez 0 (directe), 2 (notable), 3 (majeure) ou 4 (iconique) fragments et renseignez quatre réponses distinctes, une bonne réponse et une explication par question.",
      ),
      { code: "INVALID_FRAGMENT_CONFIG" },
    );
  };
  if (
    !config ||
    typeof config.enabled !== "boolean" ||
    !Number.isInteger(config.required) ||
    (config.enabled
      ? ![2, 3, 4].includes(config.required)
      : config.required !== 0) ||
    !Array.isArray(config.questions) ||
    config.questions.length > 100 ||
    (config.enabled && !config.questions.length)
  )
    invalid();
  const ids = new Set();
  const clean = (value, max) => {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      invalid();
    return value.trim();
  };
  const questions = config.questions.map((q) => {
    if (
      !q ||
      !Array.isArray(q.answers) ||
      q.answers.length !== 4 ||
      !Number.isInteger(q.correct_index) ||
      q.correct_index < 0 ||
      q.correct_index > 3
    )
      invalid();
    const answers = q.answers.map((a) => clean(a, 500));
    if (new Set(answers.map((a) => a.toLocaleLowerCase("fr"))).size !== 4)
      invalid();
    const id = q.id || randomUUID();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ) ||
      ids.has(id)
    )
      invalid();
    ids.add(id);
    if (
      q.sources !== undefined &&
      (!Array.isArray(q.sources) || q.sources.length > 10)
    )
      invalid();
    const sources = (q.sources || []).map((source) => {
      const value = clean(source, 2048);
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password)
          invalid();
      } catch {
        invalid();
      }
      return value;
    });
    return {
      sources,
      id,
      theme: clean(q.theme, 100),
      text: clean(q.text, 1000),
      answers,
      correct_index: q.correct_index,
      explanation: clean(q.explanation, 2000),
    };
  });
  return { enabled: config.enabled, required: config.required, questions };
}
module.exports = { validateFragmentConfig };
