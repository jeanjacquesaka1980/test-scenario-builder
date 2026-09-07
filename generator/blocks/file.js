'use strict';

// `file` block: if `content` is given, write it verbatim (never eval'd —
// just a string). Otherwise derive `export const <name> = {};` from the
// file name via the naming convention.

const { deriveConstName } = require('../naming-convention');

function generateContent(block) {
  const content = typeof block.content === 'string' ? block.content.trim() : '';
  if (content !== '') {
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  const constName = deriveConstName(block.name);
  return `export const ${constName} = {};\n`;
}

module.exports = { type: 'file', generateContent };
