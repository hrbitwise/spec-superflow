#!/usr/bin/env node
// scripts/install-trae.mjs — standalone entry for `ssf install-trae`.
//
// Deploys spec-superflow for Trae (CN or international edition). Detects
// ~/.trae-cn first, falls back to ~/.trae. Use --trae-dir <path> to override.
import { run } from './lib/cmd-install-trae.mjs';

run(process.argv.slice(2)).catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
