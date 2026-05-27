import { MAX_POINTS_PER_ITEM } from "./config.js";

export function shuffle(items) {
  for (let index = items.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
}

export function sampleWithoutReplacement(items, count) {
  const indexes = [...Array(items.length).keys()];
  shuffle(indexes);
  return indexes.slice(0, count).map((index) => items[index]);
}

export function computeItemPoints(elapsedSeconds) {
  return Math.max(0, MAX_POINTS_PER_ITEM - Math.floor(elapsedSeconds / 2));
}
