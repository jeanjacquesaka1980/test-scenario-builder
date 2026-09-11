'use strict';

// `spec` block: fixed nesting, not a flat list —
//
//   describe (exactly one, title)
//     use (exactly one, boolean, no config)
//     beforeEach (exactly one, boolean) + step (one-or-more, if on)
//     test (one-or-more) + title
//       step (one-or-more, per test) + title
//
// A step's own body stays empty by design — no real action/target/
// locator translation happens here, that's a human's (or an AI agent's)
// job, not this generator's. What a step (and a test) CAN optionally
// carry is a `note` (rendered as its own comment line, first thing in the
// body) and — steps only — a raw `actions` list (from the Test Scenario
// Builder's YAML export, never from a spec block authored directly in
// the Test Code Builder tab, which is title-only) — each one rendered as
// a single raw comment line, fields joined as-is, no interpretation:
//
//   step("Fill and submit", async () => {
//     // note: only needed when already logged out
//     // click, submitButton
//     // type, nameInput, John
//   });
//

// Uses this project's own custom fixtures — describe, use, beforeEach,
// test, and step all come from the SAME source (never Playwright's
// test.describe/test.use/etc. directly), so they're always one deduped
// import statement, naming only what this file actually uses (describe
// and test always; use/beforeEach/step only when actually present). The
// import path comes from the block's own `fixtureImportPath` field (set
// by the Test Scenario Builder's app-config dialog) when present;
// otherwise it falls back to the FIXTURE_IMPORT_PATH placeholder below,
// to be replaced by hand before running the generated file.
//
// Like `data`, a spec block's name is locked to one fixed suffix —
// <base>.spec.ts — since this block type only ever means "spec".
//
// If the Test Scenario Builder's YAML export carries scenarioDescription
// and/or loginAndNavigation, they're rendered as a plain comment header
// at the very top of the file, above the import — they aren't Playwright
// code, so they never go inside "describe" itself.

const FIXTURE_IMPORT_PATH = '<APP_FIXTURE_IMPORT_PATH>';

function assertSpecFileName(fileName) {
  const parts = typeof fileName === 'string' ? fileName.split('.') : [];
  if (parts.length !== 3 || parts[1] !== 'spec' || parts[2] !== 'ts') {
    throw new Error(`"${fileName}" must look like <base>.spec.ts for a Spec block`);
  }
}

function assertValidStep(step, context, index) {
  if (!step || typeof step.title !== 'string' || step.title.trim() === '') {
    throw new Error(`${context} step ${index} is missing a title`);
  }
  if (step.actions !== undefined && !Array.isArray(step.actions)) {
    throw new Error(`${context} step ${index} ("${step.title}") has a non-array "actions"`);
  }
  (step.actions || []).forEach((action, actionIndex) => {
    if (!action || typeof action.action !== 'string' || action.action.trim() === '') {
      throw new Error(`${context} step ${index} ("${step.title}") action ${actionIndex} is missing an "action" field`);
    }
  });
}

function assertValidTest(testEntry, index) {
  if (!testEntry || typeof testEntry.title !== 'string' || testEntry.title.trim() === '') {
    throw new Error(`test ${index} is missing a title`);
  }
  const steps = Array.isArray(testEntry.steps) ? testEntry.steps : [];
  if (steps.length === 0) {
    throw new Error(`test ${index} ("${testEntry.title}") needs at least one step`);
  }
  steps.forEach((step, stepIndex) => assertValidStep(step, `test "${testEntry.title}"`, stepIndex));
}

// Fields joined as-is, no interpretation — same raw-comment convention
// as the original Test Code Builder spec's action rendering.
function formatActionComment(action) {
  const fields = [action.action, action.target, action.selection, action.value].filter(
    (field) => field !== null && field !== undefined && String(field).trim() !== ''
  );
  return `// ${fields.join(', ')}`;
}

// Plain comment lines describing the scenario as a whole — not
// Playwright code, so it sits above the import, not inside describe().
function buildHeaderComment(block) {
  const lines = [`// Scenario: ${block.title}`];

  if (typeof block.description === 'string' && block.description.trim() !== '') {
    lines.push(`// Description: ${block.description}`);
  }

  const loginAndNavigation = block.loginAndNavigation;
  const hasLoginAndNavigation =
    loginAndNavigation && (loginAndNavigation.userType || loginAndNavigation.unit || loginAndNavigation.navigationFlow);
  if (hasLoginAndNavigation) {
    lines.push('// Login and Navigation:');
    if (loginAndNavigation.userType) lines.push(`//   User type: ${loginAndNavigation.userType}`);
    if (loginAndNavigation.unit) lines.push(`//   Unit: ${loginAndNavigation.unit}`);
    if (loginAndNavigation.navigationFlow) lines.push(`//   Navigation flow: ${loginAndNavigation.navigationFlow}`);
  }

  return lines;
}

function emitStep(step, indent) {
  const lines = [`${indent}step(${JSON.stringify(step.title)}, async () => {`];
  if (typeof step.note === 'string' && step.note.trim() !== '') {
    lines.push(`${indent}  // note: ${step.note}`);
  }
  const actions = Array.isArray(step.actions) ? step.actions : [];
  actions.forEach((action) => {
    lines.push(`${indent}  ${formatActionComment(action)}`);
    if (typeof action.note === 'string' && action.note.trim() !== '') {
      lines.push(`${indent}  // note: ${action.note}`);
    }
  });
  lines.push(`${indent}});`);
  return lines.join('\n');
}

function generateContent(block) {
  assertSpecFileName(block.name);

  if (typeof block.title !== 'string' || block.title.trim() === '') {
    throw new Error('spec block is missing a describe title');
  }

  const beforeEach = block.beforeEach || {};
  const beforeEachEnabled = Boolean(beforeEach.enabled);
  const beforeEachSteps = Array.isArray(beforeEach.steps) ? beforeEach.steps : [];
  if (beforeEachEnabled && beforeEachSteps.length === 0) {
    throw new Error('beforeEach is enabled but has no steps');
  }
  beforeEachSteps.forEach((step, index) => assertValidStep(step, 'beforeEach', index));

  const tests = Array.isArray(block.tests) ? block.tests : [];
  if (tests.length === 0) {
    throw new Error('spec block needs at least one test');
  }
  tests.forEach(assertValidTest);

  const needsStep = beforeEachSteps.length > 0 || tests.some((t) => t.steps.length > 0);
  const importNames = ['describe'];
  if (block.use) importNames.push('use');
  if (beforeEachEnabled) importNames.push('beforeEach');
  importNames.push('test');
  if (needsStep) importNames.push('step');

  const fixtureImportPath =
    typeof block.fixtureImportPath === 'string' && block.fixtureImportPath.trim() !== ''
      ? block.fixtureImportPath.trim()
      : FIXTURE_IMPORT_PATH;

  const lines = [...buildHeaderComment(block), ''];
  lines.push(`import { ${importNames.join(', ')} } from '${fixtureImportPath}';`, '');
  lines.push(`describe(${JSON.stringify(block.title)}, () => {`);

  if (block.use) {
    lines.push('  use({});', '');
  }

  if (beforeEachEnabled) {
    lines.push('  beforeEach(async () => {');
    for (const step of beforeEachSteps) {
      lines.push(emitStep(step, '    '));
    }
    lines.push('  });', '');
  }

  tests.forEach((testEntry) => {
    lines.push(`  test(${JSON.stringify(testEntry.title)}, async () => {`);
    if (typeof testEntry.note === 'string' && testEntry.note.trim() !== '') {
      lines.push(`    // note: ${testEntry.note}`);
    }
    for (const step of testEntry.steps) {
      lines.push(emitStep(step, '    '));
    }
    lines.push('  });', '');
  });

  if (lines[lines.length - 1] === '') lines.pop();
  lines.push('});');

  return `${lines.join('\n')}\n`;
}

module.exports = { type: 'spec', generateContent };
