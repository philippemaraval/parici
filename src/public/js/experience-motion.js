import { gsap } from "gsap";

const seen = new WeakSet();
const active = new Set();
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const pointerPreference = matchMedia(
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
);
let resetLitCard;
pointerPreference.addEventListener("change", () => resetLitCard?.());

preference.addEventListener("change", () => {
  if (!preference.matches) return;
  for (const animation of active) animation.progress(1).kill();
  active.clear();
});

export function revealSurface(element) {
  if (seen.has(element) || !element.getClientRects().length) return;
  seen.add(element);
  if (preference.matches || document.hidden) return;
  // Only animate content, never the map, its controls or a sticky ancestor.
  const cards = element.matches(".mobile-home__modes")
    ? [...element.children]
    : [element];
  const animation = gsap.fromTo(
    cards,
    { opacity: 0.65, y: 8 },
    {
      opacity: 1,
      y: 0,
      duration: 0.32,
      stagger: 0.045,
      ease: "power2.out",
      clearProps: "opacity,transform",
      onComplete: () => active.delete(animation),
    },
  );
  active.add(animation);
}

// A restrained, native adaptation of React Bits' Tilted Card interaction.
// Pointer input is opt-in: a touch gesture remains available for page scrolling.
export function attachCardLight(card) {
  if (seen.has(card)) return;
  seen.add(card);
  let frame = 0;
  const reset = () => {
    cancelAnimationFrame(frame);
    card.style.removeProperty("--experience-light-x");
    card.style.removeProperty("--experience-light-y");
    card.style.removeProperty("rotate");
    card.classList.remove("experience-card--lit");
    if (resetLitCard === reset) resetLitCard = null;
  };
  card.addEventListener(
    "pointermove",
    (event) => {
      if (!pointerPreference.matches || event.pointerType !== "mouse") return;
      if (resetLitCard !== reset) resetLitCard?.();
      resetLitCard = reset;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = card.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(1, (event.clientX - bounds.left) / bounds.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (event.clientY - bounds.top) / bounds.height),
        );
        card.style.setProperty("--experience-light-x", `${x * 100}%`);
        card.style.setProperty("--experience-light-y", `${y * 100}%`);
        // The independent rotate property leaves existing reveal transforms intact.
        card.style.rotate = `${0.5 - y} ${x - 0.5} 0 2deg`;
        card.classList.add("experience-card--lit");
      });
    },
    { passive: true },
  );
  card.addEventListener("pointerleave", reset);
  card.addEventListener("pointercancel", reset);
}
