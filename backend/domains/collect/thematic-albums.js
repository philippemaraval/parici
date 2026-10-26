"use strict";
const source = require("../../../data/collect_thematic_albums.json");

function applyThematicAlbums(catalog, thematic = source.albums) {
  const records = new Map(
    catalog.records
      .filter((r) => r.editorial_status !== "pending")
      .map((r) => [r.family + ":" + r.source_entity_id, r]),
  );
  const slugs = new Set(catalog.albums.map((a) => a.slug));
  // Validate the complete selection before mutating the generated catalogue.
  for (const album of thematic) {
    if (
      !/^theme-[a-z0-9-]+$/.test(album.slug) ||
      slugs.has(album.slug) ||
      !album.name ||
      !album.description ||
      !album.cards?.length
    )
      throw new Error(`Invalid thematic album: ${album.slug}`);
    slugs.add(album.slug);
    const seen = new Set();
    for (const card of album.cards) {
      const key = card.family + ":" + card.entity;
      if (!records.has(key) || seen.has(key))
        throw new Error(
          `Unknown or duplicated thematic card: ${album.slug} / ${key}`,
        );
      seen.add(key);
    }
  }
  for (const album of thematic) {
    for (const card of album.cards)
      records.get(card.family + ":" + card.entity).album_slugs.push(album.slug);
    catalog.albums.push({
      slug: album.slug,
      name: album.name,
      description: album.description,
      family: "thematic",
    });
  }
  return catalog;
}
module.exports = { applyThematicAlbums };
