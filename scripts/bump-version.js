#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: pnpm version:set <version>');
  process.exit(1);
}

// package.json
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
pkg.version = version;
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Cargo.toml
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
fs.writeFileSync(
  cargoPath,
  fs.readFileSync(cargoPath, 'utf8').replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
);

// tauri.conf.json
const tauriPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauri.version = version;
fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');

console.log(`v${version}`);
