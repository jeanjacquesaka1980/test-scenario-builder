'use strict';

// `spec` block: fixed nesting, not a flat list —
//
//   describe (exactly one, title)
//     use (exactly one, boolean, no config)
//     beforeEach (exactly one, boolean) + step (one-or-more, if on)
//     test (one-or-more) + title
//       step (one-or-more, per test) + title
//
// A step carries only a title — no action/target/locator, that's the
// Test Scenario Builder's job, not this generator's. Step/test bodies are
// emitted empty for the same reason.
//
// Uses this project's own custom fixtures (describe/use/step) in place
// of Playwright's test.describe/test.use/test.step, per the app's
// convention — only imported when actually used in this file. The import
// path is a placeholder; replace it with the real path to those fixtures
// in the target project before running the generated file.
//
// Like `data`, a spec block's name is locked to one fixed suffix —
// <base>.spec.ts — since this block type only ever means "spec".

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

function emitStep(step, indent) {
  return [`${indent}step(${JSON.stringify(step.title)}, async () => {`, `${indent}});`].join('\n');
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
  if (needsStep) importNames.push('step');

  const lines = [`import { ${importNames.join(', ')} } from '${FIXTURE_IMPORT_PATH}';`, ''];
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
