import { AVATAR_ART } from "./camino-art.js";

// Exported images use the same small illustrations as the live rankings.
export function loadCanvasAvatar(value) {
  const name = AVATAR_ART[String(value)] || "person";
  return new Promise(resolve => {
    const image = new Image();
    const timeout = setTimeout(() => resolve(null), 4000);
    image.onload = () => { clearTimeout(timeout); resolve(image); };
    image.onerror = () => { clearTimeout(timeout); resolve(null); };
    image.src = `/src/public/icons/${name}.svg`;
  });
}
