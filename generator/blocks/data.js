'use strict';

// `data` block: same name/path + naming-convention derivation as `file`,
// plus zero-or-more variable rows. Each becomes its own top-level `const`
// declaration; all of them land as shorthand properties on the one
// derived-name export — that object *is* the "barrel": it bundles
// whatever local consts this file declares.
//
//   const variableName: string = 'hello';
//
//   export const <derivedName> = { variableName };
//
// With zero variables it falls back to the same empty-object shape as an
// empty `file` block. `value` is written verbatim (never eval'd) — the
// author types the exact TS expression, quotes and all.
//
// Unlike `file`, a Data block's name is required to be <base>.data.ts —
// the middle segment isn't free-form here, since this block type only
// ever means "data".

const { deriveConstName } = require('../naming-convention');

function assertDataFileName(fileName) {
  const parts = typeof fileName === 'string' ? fileName.split('.') : [];
  if (parts.length !== 3 || parts[1] !== 'data' || parts[2] !== 'ts') {
    throw new Error(`"${fileName}" must look like <base>.data.ts for a Data block`);
  }
}

function assertValidVariable(variable, index) {
  if (!variable || variable.kind !== 'const') {
    throw new Error(`variable ${index} has unsupported kind "${variable && variable.kind}" (only "const" is supported)`);
  }
  if (typeof variable.name !== 'string' || variable.name.trim() === '') {
    throw new Error(`variable ${index} is missing a name`);
  }
  if (typeof variable.type !== 'string' || variable.type.trim() === '') {
    throw new Error(`variable ${index} ("${variable.name}") is missing a type`);
  }
  if (typeof variable.value !== 'string' || variable.value.trim() === '') {
    throw new Error(`variable ${index} ("${variable.name}") is missing a value`);
  }
}

function generateContent(block) {
  assertDataFileName(block.name);
  const constName = deriveConstName(block.name);
  const variables = Array.isArray(block.variables) ? block.variables : [];

  if (variables.length === 0) {
    return `export const ${constName} = {};\n`;
  }

  variables.forEach(assertValidVariable);

  // One named import per distinct (type, importPath) pair — several
  // variables can share the same custom type without duplicating it.
  const importLines = [];
  const seenImports = new Set();
  for (const variable of variables) {
    const importPath = typeof variable.importPath === 'string' ? variable.importPath.trim() : '';
    if (importPath === '') continue;
    const key = `${variable.type}|${importPath}`;
    if (seenImports.has(key)) continue;
    seenImports.add(key);
    importLines.push(`import { ${variable.type} } from '${importPath}';`);
  }

  const declarationLines = variables.map((v) => `const ${v.name}: ${v.type} = ${v.value};`);
  const propertyNames = variables.map((v) => v.name).join(', ');

  const lines = [];
  if (importLines.length > 0) {
    lines.push(...importLines, '');
  }
  lines.push(...declarationLines, '', `export const ${constName} = { ${propertyNames} };`);

  return `${lines.join('\n')}\n`;
}

module.exports = { type: 'data', generateContent };
