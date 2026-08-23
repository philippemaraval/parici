#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function digestDirectory(directory) {
  const hash = crypto.createHash('sha256');
  const entries = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) entries.push(fullPath);
    }
  }
  walk(directory);
  entries.sort();
  for (const filePath of entries) {
    hash.update(path.relative(directory, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function build() {
  execFileSync(process.execPath, ['scripts/build.js'], {
    cwd: ROOT,
    env: { ...process.env, SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || '0' },
    stdio: 'inherit',
  });
  if (!fs.existsSync(DIST)) throw new Error('dist/ was not generated');
  return digestDirectory(DIST);
}

const first = build();
const second = build();
if (first !== second) {
  throw new Error(`Build is not reproducible: ${first} != ${second}`);
}
process.stdout.write(`Reproducible build: ${first}\n`);
