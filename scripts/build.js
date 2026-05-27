#!/usr/bin/env node
/**
 * Build script:
 * 1) Bundles src/app.js into main.js (+ source map)
 * 2) Produces minified JS/CSS artifacts
 * 3) Generates a deployable dist/ folder
 *
 * IMPORTANT:
 * - backend/data/ is intentionally NOT copied to dist/
 *   (Cloudflare Pages/Vercel/Netlify free limits on large files).
 */

const fs = require("fs");
const path = require("path");
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
  "main.js",
  "main.js.map",
  "main.js.min",
  "style.css",
  "style.css.min",
  "admin",
  "data_rules.js",
  "data_rules.js.min",
  "sw.js",
  "sw.js.min",
  "site.webmanifest",
  "favicon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "data",
];

function fileSize(filePath) {
  const stat = fs.statSync(filePath);
  return `${(stat.size / 1024).toFixed(1)} KB`;
}

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

async function buildFrontendBundle() {
  if (!fs.existsSync(FRONTEND_ENTRY)) {
    throw new Error(`Missing frontend entry point: ${FRONTEND_ENTRY}`);
  }

  const unminifiedOut = path.join(ROOT, "main.js");
  const minifiedOut = path.join(ROOT, "main.js.min");

  await esbuild.build({
    entryPoints: [FRONTEND_ENTRY],
    bundle: true,
    format: "iife",
    target: ["es2019"],
    sourcemap: true,
    outfile: unminifiedOut,
    logLevel: "silent",
    legalComments: "none",
  });

  await esbuild.build({
    entryPoints: [FRONTEND_ENTRY],
    bundle: true,
    format: "iife",
    target: ["es2019"],
    minify: true,
    sourcemap: false,
    outfile: minifiedOut,
    logLevel: "silent",
    legalComments: "none",
  });

  console.log(
    `  ✅ main.js bundle: ${fileSize(unminifiedOut)} (source: src/app.js)`,
  );
  console.log(`  ✅ main.js.min: ${fileSize(minifiedOut)}`);
}

async function minifyJsFile(relativePath) {
  const src = path.join(ROOT, relativePath);
  if (!fs.existsSync(src)) {
    return;
  }

  const code = fs.readFileSync(src, "utf8");
  const result = await esbuild.transform(code, {
    loader: "js",
    minify: true,
    target: "es2019",
    legalComments: "none",
  });

  const out = `${src}.min`;
  fs.writeFileSync(out, result.code);
  console.log(`  ✅ ${relativePath}.min: ${fileSize(out)}`);
}

function minifyCss(relativePath) {
  const src = path.join(ROOT, relativePath);
  if (!fs.existsSync(src)) {
    return;
  }

  const before = fileSize(src);
  execSync(`npx cleancss -o "${src}.min" "${src}"`, { cwd: ROOT, stdio: "pipe" });
  const after = fileSize(`${src}.min`);
  console.log(`  ✅ ${relativePath}: ${before} → ${after} (saved as .min)`);
}

async function build() {
  console.log("🔨 Building Parici...\n");

  await buildFrontendBundle();
  await minifyJsFile("data_rules.js");
  await minifyJsFile("sw.js");
  minifyCss("style.css");

  generateDistFolder();
  console.log("\n✨ Build complete!");
}

build().catch((error) => {
  console.error("\n❌ Build failed:", error.message);
  process.exit(1);
});
