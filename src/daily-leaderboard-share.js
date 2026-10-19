// Share the server's ranking verbatim: its order contains the tie-breaks.
export function snapshotDailyLeaderboard(rows) {
  return Object.freeze(
    (Array.isArray(rows) ? rows : []).map((row) => Object.freeze({ ...row })),
  );
}

export function formatDailyLeaderboardResult(row) {
  if (!row.success) return `❌ ${Math.round(row.best_distance_meters || 0)}m`;
  const seconds = row.solve_time_seconds;
  const solveTime =
    Number(row.attempts_count) === 1 &&
    seconds !== null &&
    seconds !== undefined &&
    Number.isFinite(Number(seconds)) &&
    Number(seconds) >= 0
      ? `${Number(seconds).toFixed(1).replace(".", ",")} s`
      : "";
  return `${row.attempts_count}/7${solveTime ? ` · ${solveTime}` : ""}`;
}
