const budgets = require("./performance-budgets.json");

module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      url: ["/index.html?view=camino"],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        chromeFlags: "--no-sandbox",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.85 }],
        "largest-contentful-paint": ["error", { maxNumericValue: budgets.webVitals.lcpMs }],
        "cumulative-layout-shift": ["error", { maxNumericValue: budgets.webVitals.cls }],
        // Lighthouse utilise TBT comme garde-fou de laboratoire pour la réactivité ;
        // l'objectif INP terrain reste consigné dans performance-budgets.json.
        "total-blocking-time": ["error", { maxNumericValue: budgets.webVitals.inpMs }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
