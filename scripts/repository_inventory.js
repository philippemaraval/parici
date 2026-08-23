#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DELETE = process.argv.includes('--delete-identical');
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const numberedCopy = /^(.*) ([2-9]|[1-9]\d+)(\.[^/]+)$/;

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, output);
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function relative(filePath) {
  return path.relative(ROOT, filePath);
}

const files = walk(ROOT);
const findings = [];
let reclaimableBytes = 0;
let removedBytes = 0;

for (const filePath of files) {
  const match = path.basename(filePath).match(numberedCopy);
  if (!match) continue;
  const canonical = path.join(path.dirname(filePath), `${match[1]}${match[3]}`);
  const copySize = fs.statSync(filePath).size;
  if (!fs.existsSync(canonical) || !fs.statSync(canonical).isFile()) {
    findings.push({ copy: relative(filePath), canonical: relative(canonical), status: 'no-canonical' });
    continue;
  }
  const identical = fs.statSync(canonical).size === copySize && sha256(canonical) === sha256(filePath);
  findings.push({
    copy: relative(filePath),
    canonical: relative(canonical),
    status: identical ? 'identical' : 'different',
    bytes: copySize,
  });
  if (!identical) continue;
  reclaimableBytes += copySize;
  if (DELETE) {
    fs.unlinkSync(filePath);
    removedBytes += copySize;
  }
}

const largeTrackedCandidates = files
  .filter(
    (filePath) =>
      fs.existsSync(filePath) && fs.statSync(filePath).size >= 5 * 1024 * 1024,
  )
  .map((filePath) => ({ path: relative(filePath), bytes: fs.statSync(filePath).size }))
  .sort((left, right) => right.bytes - left.bytes);

const report = {
  generatedAt: new Date().toISOString(),
  mode: DELETE ? 'delete-identical' : 'inventory',
  scannedFiles: files.length,
  numberedCopies: findings.length,
  identicalCopies: findings.filter((item) => item.status === 'identical').length,
  differentCopies: findings.filter((item) => item.status === 'different').length,
  reclaimableBytes,
  removedBytes,
  findings,
  largeTrackedCandidates,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
