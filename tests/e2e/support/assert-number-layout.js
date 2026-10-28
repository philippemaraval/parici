const { expect } = require("@playwright/test");

// Checking textContent alone misses displaced digits in NumberFlow's shadow DOM.
async function expectNumberLayout(root) {
  const wrappers = root.locator(".experience-number:visible");
  await expect(wrappers.first()).toBeVisible();
  await expect
    .poll(async () =>
      wrappers.evaluateAll((elements) =>
        elements.flatMap((wrapper) => {
          const text = wrapper.querySelector(".experience-number__text");
          const flow = wrapper.querySelector("number-flow");
          const digits = [
            ...(flow?.shadowRoot?.querySelectorAll(
              ".digit__num:not([inert]), .symbol__value:not([inert])",
            ) || []),
          ];
          if (!digits.length)
            return [{ text: text?.textContent, reason: "no digits" }];
          const native = text.getBoundingClientRect();
          const boxes = digits.map((digit) => digit.getBoundingClientRect());
          const left = Math.min(...boxes.map((box) => box.left));
          const right = Math.max(...boxes.map((box) => box.right));
          const top = Math.min(...boxes.map((box) => box.top));
          const bottom = Math.max(...boxes.map((box) => box.bottom));
          const aligned =
            digits.map((digit) => digit.textContent).join("") ===
              text.textContent &&
            Math.abs(left - native.left) < 1 &&
            Math.abs(right - native.right) < 1 &&
            Math.abs(top - native.top) < 3 &&
            Math.abs(bottom - native.bottom) < 3;
          return aligned
            ? []
            : [
                {
                  text: text.textContent,
                  actual: digits.map((d) => d.textContent).join(""),
                  native: {
                    left: native.left,
                    right: native.right,
                    top: native.top,
                    bottom: native.bottom,
                  },
                  actualBox: { left, right, top, bottom },
                },
              ];
        }),
      ),
    )
    .toEqual([]);
}

module.exports = { expectNumberLayout };
