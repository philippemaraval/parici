#!/usr/bin/env node
/**
 * Build script:
 * 1) Generates performance assets
 * 2) Bundles and minifies source files in memory
 * 3) Generates the sole deployable artifact: dist/
 *
 * IMPORTANT:
 * - backend/data/ is intentionally NOT copied to dist/
 *   (Cloudflare Pages/Vercel/Netlify free limits on large files).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const FRONTEND_ENTRY = path.join(ROOT, "src", "app.js");

const DIST_INCLUDE = [
  "_headers",
  "googlee4a7e2d5ea351f02.html",
  "index.html",
  "arbre-rangs.html",
  "regles.html",
  "reset-password.html",
  "forgot-password.html",
  "confidentialite.html",
  "admin",
  "src/public",
  "data_rules.js",
  "sw.js",
  "site.webmanifest",
  "apple-touch-icon.png",
  "camino-paris-favicon.ico",
  "data",
];

function copyItemToDist(relativePath) {
  const src = path.join(ROOT, relativePath);
  if (!fs.existsSync(src)) {
    return;
  }

  const dest = path.join(DIST_DIR, relativePath);
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function generateDistFolder() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  DIST_INCLUDE.forEach(copyItemToDist);

  const backendDataInDist = path.join(DIST_DIR, "backend", "data");
  if (fs.existsSync(backendDataInDist)) {
    fs.rmSync(backendDataInDist, { recursive: true, force: true });
  }

  console.log("  ✅ dist/ generated (backend/data excluded)");
}

function runPerformanceAssetPipelines() {
  execSync("node scripts/build_map_assets.js", { cwd: ROOT, stdio: "inherit" });
}

function fingerprintName(label, extension, content) {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `${label}.${hash}.${extension}`;
}

function writeFingerprintedAsset(label, extension, content, assetManifest) {
  const fileName = fingerprintName(label, extension, content);
  const relativeUrl = `/assets/${fileName}`;
  const outputPath = path.join(DIST_DIR, "assets", fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  assetManifest[`${label}.${extension}`] = relativeUrl;
  return relativeUrl;
}

async function minifiedSource(relativePath, loader) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const result = await esbuild.transform(source, {
    loader,
    minify: true,
    target: loader === "js" ? "es2019" : undefined,
    legalComments: "none",
  });
  return result.code;
}

function replaceAssetReference(html, sourcePath, targetUrl) {
  const escaped = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`${escaped}(?:\\?[^"'\\s>]*)?`, "g"), targetUrl);
}

async function fingerprintProductionAssets() {
  const assetManifest = {};
  const mainBundle = await esbuild.build({
    entryPoints: [FRONTEND_ENTRY],
    bundle: true,
    format: "iife",
    target: ["es2019"],
    minify: true,
    sourcemap: false,
    write: false,
    logLevel: "silent",
    legalComments: "none",
  });
  const mainUrl = writeFingerprintedAsset(
    "main",
    "js",
    mainBundle.outputFiles[0].contents,
    assetManifest,
  );
  const dataRulesUrl = writeFingerprintedAsset(
    "data-rules",
    "js",
    await minifiedSource("data_rules.js", "js"),
    assetManifest,
  );
  const styleUrl = writeFingerprintedAsset(
    "style",
    "css",
    await minifiedSource("style.css", "css"),
    assetManifest,
  );
  const siteShellCssUrl = writeFingerprintedAsset(
    "site-shell",
    "css",
    await minifiedSource("src/public/css/site-shell.css", "css"),
    assetManifest,
  );
  const siteShellJsUrl = writeFingerprintedAsset(
    "site-shell",
    "js",
    await minifiedSource("src/public/js/site-shell.js", "js"),
    assetManifest,
  );
  const polylineOffsetUrl = writeFingerprintedAsset(
    "leaflet-polylineoffset",
    "js",
    await minifiedSource("src/public/js/leaflet.polylineoffset.js", "js"),
    assetManifest,
  );
  const leafletBundle = await esbuild.build({
    stdin: {
      contents: 'window.L = require("leaflet");',
      loader: "js",
      resolveDir: ROOT,
      sourcefile: "leaflet-runtime.js",
    },
    bundle: true,
    format: "iife",
    target: ["es2019"],
    minify: true,
    sourcemap: false,
    write: false,
    logLevel: "silent",
    legalComments: "none",
  });
  const leafletRuntimeUrl = writeFingerprintedAsset(
    "leaflet-runtime",
    "js",
    leafletBundle.outputFiles[0].contents,
    assetManifest,
  );
  const leafletCssUrl = writeFingerprintedAsset(
    "leaflet",
    "css",
    await minifiedSource("node_modules/leaflet/dist/leaflet.css", "css"),
    assetManifest,
  );
  const mapDependenciesSource = (
    await minifiedSource("src/public/js/map-dependencies.js", "js")
  )
    .replace("/vendor/leaflet.css", leafletCssUrl)
    .replace("/src/public/js/leaflet-runtime.js", leafletRuntimeUrl)
    .replace("/src/public/js/leaflet.polylineoffset.js", polylineOffsetUrl);
  const mapDependenciesUrl = writeFingerprintedAsset(
    "map-dependencies",
    "js",
    mapDependenciesSource,
    assetManifest,
  );

  const indexPath = path.join(DIST_DIR, "index.html");
  let indexHtml = fs.readFileSync(indexPath, "utf8");
  indexHtml = replaceAssetReference(indexHtml, "style.css", styleUrl);
  indexHtml = replaceAssetReference(indexHtml, "/src/public/css/site-shell.css", siteShellCssUrl);
  indexHtml = replaceAssetReference(indexHtml, "/src/public/js/map-dependencies.js", mapDependenciesUrl);
  indexHtml = replaceAssetReference(indexHtml, "data_rules.js", dataRulesUrl);
  indexHtml = replaceAssetReference(indexHtml, "main.js", mainUrl);
  fs.writeFileSync(indexPath, indexHtml);

  const rulesPath = path.join(DIST_DIR, "regles.html");
  if (fs.existsSync(rulesPath)) {
    let rulesHtml = fs.readFileSync(rulesPath, "utf8");
    rulesHtml = replaceAssetReference(rulesHtml, "/src/public/css/site-shell.css", siteShellCssUrl);
    rulesHtml = replaceAssetReference(rulesHtml, "/src/public/js/site-shell.js", siteShellJsUrl);
    fs.writeFileSync(rulesPath, rulesHtml);
  }

  fs.writeFileSync(
    path.join(DIST_DIR, "asset-manifest.json"),
    `${JSON.stringify(assetManifest, null, 2)}\n`,
  );

  const serviceWorkerPath = path.join(DIST_DIR, "sw.js");
  let serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
  serviceWorker = serviceWorker
    .replace(/const CACHE_NAME = "[^"]+";/, `const CACHE_NAME = "camino-paris-${fingerprintName("assets", "cache", JSON.stringify(assetManifest)).split(".")[1]}";`)
    .replace(/"\/style\.css\?[^"]+",?\n/, `"${styleUrl}",\n`)
    .replace(/"\/main\.js\?[^"]+",?\n/, `"${mainUrl}",\n`)
    .replace(/"\/src\/public\/css\/site-shell\.css\?[^"]+",?\n/, `"${siteShellCssUrl}",\n`)
    .replace(/"\/src\/public\/js\/site-shell\.js\?[^"]+",?\n/, `"${siteShellJsUrl}",\n`)
    .replace(/"\/src\/public\/js\/map-dependencies\.js",?\n/, `"${mapDependenciesUrl}",\n`)
    .replace(/"\/src\/public\/js\/leaflet-runtime\.js",?\n/, `"${leafletRuntimeUrl}",\n`)
    .replace(/"\/src\/public\/js\/leaflet\.polylineoffset\.js\?[^"]+",?\n/, `"${polylineOffsetUrl}",\n`)
    .replace(/"\/vendor\/leaflet\.css",?\n/, `"${leafletCssUrl}",\n`)
    .replace(/"\/data_rules\.js",?\n/, `"${dataRulesUrl}",\n`)
    .replace(/\s*"\/data\/paris_rues_light\.geojson\?[^"]+",?\n/, "\n")
    .replace(/\s*"\/data\/paris_quartiers\.geojson\?[^"]+",?\n/, "\n")
    .replace(/\s*"\/data\/paris_monuments\.geojson",?\n/, "\n")
    .replace(/\s*"\/data\/paris_transit_lines\.geojson\?[^"]+",?\n/, "\n")
    .replace(/\s*"\/data\/street_infos\.json",?\n/, "\n");
  fs.writeFileSync(serviceWorkerPath, serviceWorker);
  const minifiedServiceWorker = await esbuild.transform(serviceWorker, {
    loader: "js",
    minify: true,
    target: "es2019",
    legalComments: "none",
  });
  fs.writeFileSync(serviceWorkerPath, minifiedServiceWorker.code);

  [
    "src/public/css/site-shell.css",
    "src/public/js/site-shell.js",
    "src/public/js/map-dependencies.js",
    "src/public/js/leaflet.polylineoffset.js",
  ].forEach((relativePath) => {
    fs.rmSync(path.join(DIST_DIR, relativePath), { force: true });
  });

  const sourceMaps = [];
  function collectSourceMaps(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectSourceMaps(fullPath);
      else if (entry.name.endsWith(".map")) sourceMaps.push(fullPath);
    }
  }
  collectSourceMaps(DIST_DIR);
  if (sourceMaps.length) {
    throw new Error(`Production source maps detected: ${sourceMaps.join(", ")}`);
  }

  console.log(`  ✅ ${Object.keys(assetManifest).length} ressources fingerprintées et minifiées`);
}

async function build() {
  console.log("Building Parici...\n");

  runPerformanceAssetPipelines();
  generateDistFolder();
  await fingerprintProductionAssets();
  console.log("\n✨ Build complete!");
}

build().catch((error) => {
  console.error("\n❌ Build failed:", error.message);
  process.exit(1);
});
