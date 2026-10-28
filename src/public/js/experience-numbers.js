import "number-flow";

const previousValues = new WeakMap();

// Keep the original text in the light DOM: screen readers, copy/paste and
// gameplay code always get the final value, independently of the animation.
export function enhanceNumber(root) {
  if (root.querySelector(".experience-number")) return;
  const previous = previousValues.get(root) || [];
  const values = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest("button, a, .sr-only")) continue;
    const fragment = document.createDocumentFragment();
    const parts = node.data.split(/(\d+(?:[.,]\d+)?)/g);
    parts.forEach((part, index) => {
      if (index % 2 === 0) {
        fragment.append(part);
        return;
      }
      const value = Number(part.replace(",", "."));
      const old = previous[values.length];
      values.push(value);
      const wrapper = document.createElement("span");
      wrapper.className = "experience-number";
      const text = document.createElement("span");
      text.className = "experience-number__text";
      text.textContent = part;
      const flow = document.createElement("number-flow");
      flow.setAttribute("aria-hidden", "true");
      // Match the native text rather than changing decimal punctuation in the
      // decorative layer (profile averages currently use a dot).
      flow.locales = part.includes(".") ? "en-US" : "fr-FR";
      const decimals = part.split(/[.,]/)[1]?.length || 0;
      flow.format = {
        useGrouping: false,
        // Keep the exact integer width, including 00 in countdowns.
        minimumIntegerDigits: part.split(/[.,]/)[0].length,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      };
      flow.transformTiming = { duration: 420, easing: "ease-out" };
      flow.spinTiming = { duration: 420, easing: "ease-out" };
      flow.opacityTiming = { duration: 180, easing: "ease-out" };
      wrapper.append(text, flow);
      fragment.append(wrapper);
      flow.update(old ?? value);
      requestAnimationFrame(() => {
        if (!wrapper.isConnected) return;
        wrapper.classList.add("is-enhanced");
        flow.update(value);
      });
    });
    if (parts.length > 1) node.replaceWith(fragment);
  }
  previousValues.set(root, values);
}
