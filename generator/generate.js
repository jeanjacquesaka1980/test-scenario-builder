#!/usr/bin/env node
'use strict';

// Test Code Builder — Generator.
//
// This is the other half of the Test Code Builder tab in the browser
// app. That tab (code-builder.js) is pure authoring UI: it only produces
// a YAML file and has no filesystem access. This script is what actually
// writes files — it runs from the command line INSIDE the target
// project, reads a YAML file, and writes real files with `fs`. It does
// not run in the browser and knows nothing about the browser tool beyond
// the YAML shape they agree on.
//
// Usage:
//   node generator/generate.js <path-to-yaml> [--out <dir>] [--force] [--dry-run] [--cleanup]
//
// v1: only `file` blocks are supported (matches the Builder's current
// build step). describe/use/beforeEach/tests come later, on both sides.
//
// These YAML files are disposable scratch input for one generation run
// each — not a persistent contract with the code they produce. Keep them
// out of version control (e.g. a .scratch/ folder, see .gitignore) and
// discard them once a run succeeds; --cleanup can do that for you, but
// only when you ask for it.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      args.force = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--cleanup') {
      args.cleanup = true;
    } else if (arg === '--out') {
      i += 1;
      args.out = argv[i];
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/* ==========================================================================
   NAMING CONVENTION (file blocks with no content) — fixed rule, not
   configurable. "no-data-shown.data.ts" -> base "no-data-shown", suffix
   "data" -> "export const noDataShownData = {};". A file name that isn't
   exactly <base>.<suffix>.ts is a hard error, not a silent fallback.
   ========================================================================== */

function kebabToCamel(str) {
  return str
    .split('-')
    .filter((word) => word !== '')
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

function deriveConstName(fileName) {
  const parts = fileName.split('.');
  if (parts.length !== 3 || parts[2] !== 'ts') {
    throw new Error(
      `"${fileName}" must look like <base>.<suffix>.ts to derive an export name (got ${parts.length} dot-separated part${parts.length === 1 ? '' : 's'})`
    );
  }
  const [base, suffix] = parts;
  if (base === '' || suffix === '') {
    throw new Error(`"${fileName}" is missing its base name or suffix`);
  }
  const capitalizedSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
  return `${kebabToCamel(base)}${capitalizedSuffix}`;
}

// `content`, when present, is treated purely as a string to write
// verbatim — never eval'd or otherwise executed.
function generateFileBlockContent(block) {
  const content = typeof block.content === 'string' ? block.content.trim() : '';
  if (content !== '') {
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  const constName = deriveConstName(block.name);
  return `export const ${constName} = {};\n`;
}

/* ==========================================================================
   SECURITY — every path in the YAML is untrusted input, even though the
   user authors it themselves: mistakes happen, and this is what stands
   between a typo and fs.writeFileSync landing somewhere it shouldn't.
   ========================================================================== */

function assertSafeName(name) {
  if (typeof name !== 'string' || name === '') {
    throw new Error('file name is missing');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`file name "${name}" must not contain path separators`);
  }
  if (name.includes('\0')) {
    throw new Error(`file name "${name}" contains a null byte`);
  }
}

// Resolves `path/name` against `root` and rejects anything that escapes
// it — this is what blocks "../../" traversal and absolute paths like
// "/etc/...", since both simply fail to land back inside `root` once
// resolved.
function resolveSafeTargetPath(root, blockPath, name) {
  assertSafeName(name);

  const rawPath = typeof blockPath === 'string' ? blockPath : '';
  if (rawPath.includes('\0')) {
    throw new Error(`path "${rawPath}" contains a null byte`);
  }

  const target = path.resolve(root, rawPath, name);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`resolved path "${target}" falls outside the project root "${root}"`);
  }

  return target;
}

/* ==========================================================================
   MAIN
   ========================================================================== */

function buildPlan(blocks, root, force) {
  return blocks.map((block, index) => {
    if (!block || block.type !== 'file') {
      const type = block && block.type;
      return { index, error: `block ${index} has unsupported type "${type}" (only "file" blocks are supported by this generator version)` };
    }

    try {
      const targetPath = resolveSafeTargetPath(root, block.path, block.name);
      const content = generateFileBlockContent(block);
      const exists = fs.existsSync(targetPath);
      if (exists && !force) {
        return { index, targetPath, error: `"${targetPath}" already exists (re-run with --force to overwrite it)` };
      }
      return { index, targetPath, content, willOverwrite: exists };
    } catch (err) {
      return { index, error: err.message };
    }
  });
}

function printPlan(root, plan) {
  console.log(`Project root: ${root}`);
  console.log('');
  console.log('Plan:');
  for (const item of plan) {
    if (item.error) {
      console.log(`  ERROR (block ${item.index}): ${item.error}`);
    } else {
      console.log(`  ${item.willOverwrite ? 'OVERWRITE' : 'WRITE'} ${item.targetPath}`);
    }
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const yamlPath = args._[0];
  if (!yamlPath) {
    fail('usage: node generator/generate.js <path-to-yaml> [--out <dir>] [--force] [--dry-run] [--cleanup]');
  }

  const root = path.resolve(args.out || process.cwd());

  let raw;
  try {
    raw = fs.readFileSync(yamlPath, 'utf8');
  } catch (err) {
    fail(`could not read "${yamlPath}": ${err.message}`);
  }

  let doc;
  try {
    // js-yaml's `load` (v4+) is already the safe loader — no custom
    // types, no arbitrary object construction, nothing executable.
    doc = yaml.load(raw);
  } catch (err) {
    fail(`could not parse YAML: ${err.message}`);
  }

  const blocks = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
  if (blocks.length === 0) {
    fail('no blocks found in YAML (expected a top-level "blocks" array)');
  }

  const plan = buildPlan(blocks, root, args.force);
  printPlan(root, plan);

  const errors = plan.filter((item) => item.error);
  if (errors.length > 0) {
    fail(`${errors.length} block(s) failed validation — nothing was written. Fix the issue(s) above and re-run.`);
  }

  if (args.dryRun) {
    console.log('Dry run: nothing was written.');
    return;
  }

  for (const item of plan) {
    fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
    fs.writeFileSync(item.targetPath, item.content, 'utf8');
  }
  console.log(`Wrote ${plan.length} file(s).`);

  if (args.cleanup) {
    fs.unlinkSync(path.resolve(yamlPath));
    console.log(`Deleted input YAML: ${yamlPath}`);
  }
}

main();
