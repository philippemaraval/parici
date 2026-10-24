// @ts-check
/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Réponse API invalide");
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value @returns {import('./api').VerifiedSession} */
export function parseVerifiedSession(value) {
  const row = object(value);
  if (
    typeof row.sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.sessionId,
    ) ||
    !Array.isArray(row.targets) ||
    !row.targets.length ||
    !row.targets.every(
      (target) => typeof target === "string" && target.length > 0,
    )
  )
    throw new Error("Session vérifiée invalide");
  return {
    sessionId: /** @type {import('./api').UUID} */ (row.sessionId),
    targets: row.targets,
  };
}
/** @param {unknown} value @returns {import('./api').CollectGame} */
export function parseCollectGame(value) {
  const row = object(value),
    card = object(row.card);
  if (
    typeof row.gameId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.gameId,
    ) ||
    !["street", "district", "monument", "bus"].includes(String(card.family)) ||
    typeof card.name !== "string" ||
    typeof card.imageReference !== "string" ||
    !Number.isInteger(row.maxAttempts) ||
    Number(row.maxAttempts) < 1 ||
    !Array.isArray(row.guesses)
  )
    throw new Error("Partie Collect invalide");
  const quota = object(row.quota);
  if (typeof quota.copies !== "number" || typeof quota.limit !== "number")
    throw new Error("Quota Collect invalide");
  return /** @type {import('./api').CollectGame} */ (value);
}
/** @param {unknown} value @returns {import('./api').ExplorerProgressPayload} */
export function parseExplorerProgress(value) {
  const row = object(value),
    profile = object(row.profile);
  if (
    !Array.isArray(row.progress) ||
    typeof profile.completed !== "boolean" ||
    typeof profile.solved_count !== "number"
  )
    throw new Error("Progression Explorer invalide");
  for (const entry of row.progress) {
    const progress = object(entry);
    if (
      !/^[1-9][0-9]*$/.test(String(progress.riddle_id)) ||
      typeof progress.points_earned !== "number"
    )
      throw new Error("Étape Explorer invalide");
  }
  return /** @type {import('./api').ExplorerProgressPayload} */ (value);
}
