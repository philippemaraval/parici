#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, "performance-budgets.json"), "utf8"));
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`  ❌ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

function bytes(filePath) {
  return fs.statSync(filePath).size;
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KB`;
}

function assertMaximum(label, actual, maximum) {
  if (actual > maximum) fail(`${label}: ${formatBytes(actual)} > ${formatBytes(maximum)}`);
  else pass(`${label}: ${formatBytes(actual)} / ${formatBytes(maximum)}`);
}

function collectFiles(directory, predicate, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath, predicate, output);
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

function main() {
  if (!fs.existsSync(DIST)) {
    fail("dist/ est absent ; exécutez npm run build");
  } else {
    const assetManifestPath = path.join(DIST, "asset-manifest.json");
    if (!fs.existsSync(assetManifestPath)) {
      fail("asset-manifest.json est absent");
    } else {
      const manifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf8"));
      const entryPath = path.join(DIST, manifest["main.js"] || "");
      if (!fs.existsSync(entryPath)) {
        fail("bundle main fingerprinté introuvable");
      } else {
        assertMaximum(
          "Bundle JavaScript principal",
          bytes(entryPath),
          budgets.assets.maxEntryJavaScriptBytes,
        );
      }

      const indexHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
      const initialScriptUrls = [...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((url) => url.startsWith("/assets/"));
      const initialJavaScriptBytes = initialScriptUrls.reduce((total, url) => {
        const filePath = path.join(DIST, url);
        return total + (fs.existsSync(filePath) ? bytes(filePath) : 0);
      }, 0);
      assertMaximum(
        "JavaScript initial local",
        initialJavaScriptBytes,
        budgets.assets.maxInitialJavaScriptBytes,
      );

      const stylesheetUrls = [...indexHtml.matchAll(/<link[^>]+href=["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((url) => url.startsWith("/assets/") && url.endsWith(".css"));
      for (const url of stylesheetUrls) {
        const filePath = path.join(DIST, url);
        if (fs.existsSync(filePath)) {
          assertMaximum(
            `Feuille ${path.basename(filePath)}`,
            bytes(filePath),
            budgets.assets.maxStylesheetBytes,
          );
        }
      }

      if (/[?&]v=/.test(indexHtml)) fail("index.html contient encore un versionnage manuel ?v=");
      else pass("index.html utilise des noms de fichiers fingerprintés");
    }

    const sourceMaps = collectFiles(DIST, (filePath) => filePath.endsWith(".map"));
    if (sourceMaps.length) fail(`${sourceMaps.length} source map(s) publiée(s) dans dist/`);
    else pass("Aucune source map publiée");
  }

  const mapManifestPath = path.join(ROOT, "data", "map", "manifest.json");
  if (!fs.existsSync(mapManifestPath)) {
    fail("Manifest cartographique optimisé absent");
  } else {
    const mapManifest = JSON.parse(fs.readFileSync(mapManifestPath, "utf8"));
    const overviewPath = path.join(ROOT, String(mapManifest.overview?.url || "").replace(/^\/+/, ""));
    if (!fs.existsSync(overviewPath)) {
      fail("Carte overview fingerprintée absente");
    } else {
      const payload = fs.readFileSync(overviewPath);
      assertMaximum("Carte overview", payload.length, budgets.assets.maxMapOverviewBytes);
      assertMaximum(
        "Carte overview compressée",
        zlib.gzipSync(payload, { level: 9 }).length,
        budgets.assets.maxMapOverviewGzipBytes,
      );
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} budget(s) dépassé(s).`);
    process.exit(1);
  }
  console.log("\n✨ Tous les budgets de performance sont respectés.");
}

main();
