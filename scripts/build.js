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
  "explorer.html",
  "collect.html",
  "arbre-rangs.html",
  "regles.html",
  "versions.html",
  "remarques.html",
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
  for(const privateFile of ["collect_paris_catalog.json","collect_question_additions.json","collect_fragment_plan.json"])fs.rmSync(path.join(DIST_DIR,"data",privateFile),{force:true});

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
  const studioPagePath = path.join(DIST_DIR, "admin/studio.html");
  if(fs.existsSync(studioPagePath)) {
    let studioHtml=fs.readFileSync(studioPagePath,"utf8");
    studioHtml=studioHtml.replace(/https:\/\/unpkg.com\/leaflet@1.9.4\/dist\/leaflet.css/g,leafletCssUrl).replace(/https:\/\/unpkg.com\/leaflet@1.9.4\/dist\/leaflet.js/g,leafletRuntimeUrl).replace(/ integrity="[^"]*" crossorigin=""/g,"");
    fs.writeFileSync(studioPagePath,studioHtml);
  }
  let adminBuildCommit=null;
  try {adminBuildCommit=execSync("git rev-parse HEAD",{cwd:ROOT,encoding:"utf8"}).trim();} catch { /* Source archives may have no Git directory. */ }
  fs.writeFileSync(path.join(DIST_DIR,"admin/build-info.json"),JSON.stringify({commit:process.env.CF_PAGES_COMMIT_SHA||process.env.RENDER_GIT_COMMIT||adminBuildCommit,builtAt:new Date().toISOString()}));
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

  // Content-address this shared stylesheet so returning players see visual updates.
  const caminoArtCssUrl = writeFingerprintedAsset(
    "camino-art", "css",
    await minifiedSource("src/public/css/camino-art.css", "css"),
    assetManifest,
  );
  const fluidLayoutUrl = writeFingerprintedAsset(
    "fluid-layout", "css", await minifiedSource("src/public/css/fluid-layout.css", "css"), assetManifest,
  );
  const interfaceIconsUrl = writeFingerprintedAsset(
    "interface-icons", "js",
    await minifiedSource("src/public/js/interface-icons.js", "js"),
    assetManifest,
  );
  for (const page of ["index.html", "regles.html", "arbre-rangs.html", "admin/users.html"]) {
    const pagePath = path.join(DIST_DIR, page);
    if (!fs.existsSync(pagePath)) continue;
    const html = fs.readFileSync(pagePath, "utf8");
    const artStyles = replaceAssetReference(html, "/src/public/css/camino-art.css", caminoArtCssUrl);
    const withStyles = replaceAssetReference(artStyles, "/src/public/css/fluid-layout.css", fluidLayoutUrl);
    fs.writeFileSync(pagePath, replaceAssetReference(withStyles, "/src/public/js/interface-icons.js", interfaceIconsUrl));
  }

  const menuUrl = writeFingerprintedAsset("site-menu", "js", await minifiedSource("src/public/js/site-menu.js", "js"), assetManifest);
  const navigationSource = (await minifiedSource("src/public/js/site-navigation.js", "js")).replace(/\/src\/public\/js\/site-menu\.js(?:\?[^"']*)?/, menuUrl);
  const navigationUrl = writeFingerprintedAsset("site-navigation", "js", navigationSource, assetManifest);
  const gesturesUrl = writeFingerprintedAsset("page-gestures", "js", await minifiedSource("src/public/js/page-gestures.js", "js"), assetManifest);
  for (const page of DIST_INCLUDE.filter(file => file.endsWith(".html"))) {
    const file = path.join(DIST_DIR, page);
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, "utf8");
    for (const [source, target] of [["/src/public/js/site-navigation.js", navigationUrl], ["/src/public/js/page-gestures.js", gesturesUrl], ["/src/public/js/site-shell.js", siteShellJsUrl], ["/src/public/css/site-shell.css", siteShellCssUrl]]) html = replaceAssetReference(html, source, target);
    fs.writeFileSync(file, html);
  }

  // Collect uses the same locally bundled Leaflet runtime as Camino and Daily.
  const collectLoaderUrl = writeFingerprintedAsset(
    "collect-map-loader", "js",
    (await minifiedSource("src/public/js/collect-map-loader.js", "js"))
      .replace("/src/public/js/leaflet-runtime.js", leafletRuntimeUrl)
      .replace("/src/public/js/leaflet.polylineoffset.js", polylineOffsetUrl), assetManifest,
  );
  const collectPagePath = path.join(DIST_DIR, "collect.html");
  let collectHtml = fs.readFileSync(collectPagePath, "utf8");
  collectHtml = replaceAssetReference(collectHtml, "/style.css", styleUrl);
  collectHtml = replaceAssetReference(collectHtml, "/src/public/css/site-shell.css", siteShellCssUrl);
  collectHtml = replaceAssetReference(collectHtml, "/vendor/leaflet.css", leafletCssUrl);
  collectHtml = replaceAssetReference(collectHtml, "/src/public/js/site-shell.js", siteShellJsUrl);
  collectHtml = replaceAssetReference(collectHtml, "/src/public/js/collect-map-loader.js", collectLoaderUrl);
  for (const [source, label, type] of [
    ["src/public/js/collect.js", "collect", "js"],
    ["src/public/js/collect-notifications.js", "collect-notifications", "js"],
    ...["collect", "collect-details", "collect-sections", "collect-reveal", "collect-theme", "collect-cards"]
      .map(name => [`src/public/css/${name}.css`, name, "css"]),
  ]) {
    const content = ["collect","collect-notifications"].includes(label) && type === "js"
      ? (await esbuild.build({ entryPoints:[path.join(ROOT,source)], bundle:true, write:false, minify:true, format:"iife", target:"es2019" })).outputFiles[0].text
      : await minifiedSource(source, type);
    const url = writeFingerprintedAsset(label, type, content, assetManifest);
    collectHtml = replaceAssetReference(collectHtml, "/" + source, url);
  }
  fs.writeFileSync(collectPagePath, collectHtml);

  const explorerCssUrl = writeFingerprintedAsset(
    "explorer",
    "css",
    await minifiedSource("src/public/css/explorer.css", "css"),
    assetManifest,
  );
  const explorerJsUrl = writeFingerprintedAsset(
    "explorer",
    "js",
    await minifiedSource("src/public/js/explorer_core.js", "js"),
    assetManifest,
  );
  const explorerSelectionUrl = writeFingerprintedAsset(
    "explorer-selection",
    "js",
    await minifiedSource("src/public/js/explorer-selection.js", "js"),
    assetManifest,
  );
  const explorerPath = path.join(DIST_DIR, "explorer.html");
  let explorerHtml = fs.readFileSync(explorerPath, "utf8");
  for (const [source, target] of [
    ["/src/public/css/explorer.css", explorerCssUrl],
    ["/src/public/js/explorer_core.js", explorerJsUrl],
    ["/src/public/js/explorer-selection.js", explorerSelectionUrl],
  ])
    explorerHtml = replaceAssetReference(explorerHtml, source, target);
  fs.writeFileSync(explorerPath, explorerHtml);
  const explorerAdminPath = path.join(DIST_DIR, "admin/explorer/index.html");
  let explorerAdminHtml = fs.readFileSync(explorerAdminPath, "utf8");
  for (const [source, target] of [
    ["/vendor/leaflet.css", leafletCssUrl],
    ["/src/public/js/leaflet-runtime.js", leafletRuntimeUrl],
  ])
    explorerAdminHtml = replaceAssetReference(
      explorerAdminHtml,
      source,
      target,
    );
  fs.writeFileSync(explorerAdminPath, explorerAdminHtml);

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
    .replace('"/src/public/js/site-navigation.js"', JSON.stringify(navigationUrl))
    .replace('"/src/public/js/site-menu.js"', JSON.stringify(menuUrl))
    .replace('"/src/public/js/page-gestures.js"', JSON.stringify(gesturesUrl))
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
