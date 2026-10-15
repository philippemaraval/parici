"use strict";
const catalog = require("../../../data/collect_paris_catalog.json");
async function editorialHealth(pool) {
  const albums = (
    await pool.query(`SELECT a.slug,COUNT(ac.card_id)::int AS actual FROM albums a LEFT JOIN album_cards ac ON ac.album_id=a.id
    WHERE a.slug IN ('famous-streets','main-streets') GROUP BY a.slug`)
  ).rows;
  const issues = [];
  for (const slug of ["famous-streets", "main-streets"]) {
    const expected = catalog.records.filter((c) =>
      c.album_slugs.includes(slug),
    ).length;
    const actual = albums.find((a) => a.slug === slug)?.actual || 0;
    if (actual !== expected)
      issues.push({
        domain: "collect",
        key: slug,
        title:
          slug === "famous-streets"
            ? "Album Rues célèbres"
            : "Album Rues principales",
        issue: `${actual} cartes associées ; ${expected} attendues dans le référentiel parisien`,
        url: "/admin/collect/",
      });
  }
  const corrected = (
    await pool.query(
      "SELECT COUNT(*)::int AS descriptions FROM cards WHERE status='active' AND NULLIF(description_full_override,'') IS NOT NULL",
    )
  ).rows[0].descriptions;
  return {
    issues,
    photographs: catalog.records.filter(
      (c) => c.illustration.kind === "photograph",
    ).length,
    cartographic: catalog.records.filter(
      (c) => c.illustration.kind !== "photograph",
    ).length,
    referencePoints: catalog.records.filter(
      (c) => c.illustration.kind === "reference-point",
    ).length,
    ...require("./description-coverage").descriptionCoverage(
      catalog,
      require("../../../data/collect_descriptions.json"),
    ),
    correctedDescriptions: corrected,
  };
}
module.exports = { editorialHealth };
