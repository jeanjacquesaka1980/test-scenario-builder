'use strict';

// Fixed rule, not configurable: "no-data-shown.data.ts" -> base
// "no-data-shown", suffix "data" -> export name "noDataShownData". A file
// name that isn't exactly <base>.<suffix>.ts is a hard error, not a
// silent fallback. Shared by every block type that derives an export
// name from its file name (currently file.js and data.js).

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

module.exports = { kebabToCamel, deriveConstName };
