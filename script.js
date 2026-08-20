'use strict';

/* ==========================================================================
   CONFIG / DATA
   Everything that defines "what actions exist" and "what fields an action
   uses" lives here. Extend these two structures to add new actions later —
   no other code needs to change.
   ========================================================================== */

// Source of truth for the action dropdown. Order here is the order shown.
const ACTIONS = [
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'focus',
  'blur',
  'dragTo',
  'setInputFiles',
  'scrollIntoViewIfNeeded',
  'assertVisible',
  'assertHidden',
  'assertText',
  'assertValue',
  'assertChecked',
  'assertCount',
  'assertEnabled',
  'assertDisabled',
  'waitFor',
];

// Actions allowed inside an assertion block — only assertions belong there,
// never a plain interaction step or a nested test.
const ASSERTION_ACTIONS = ACTIONS.filter((action) => action.startsWith('assert'));

// Per-action lookup of which of (target, selection, value) apply.
// Any action missing from this map falls back to DEFAULT_FIELD_CONFIG below.
const ACTION_FIELD_CONFIG = {
  click: { target: true, selection: false, value: false },
  dblclick: { target: true, selection: false, value: false },
  fill: { target: true, selection: false, value: true },
  type: { target: true, selection: false, value: true },
  press: { target: true, selection: false, value: true },
  check: { target: true, selection: false, value: false },
  uncheck: { target: true, selection: false, value: false },
  selectOption: { target: true, selection: true, value: true },
  hover: { target: true, selection: false, value: false },
  focus: { target: true, selection: false, value: false },
  blur: { target: true, selection: false, value: false },
  dragTo: { target: true, selection: false, value: true },
  setInputFiles: { target: true, selection: false, value: true },
  scrollIntoViewIfNeeded: { target: true, selection: false, value: false },
  assertVisible: { target: true, selection: false, value: false },
  assertHidden: { target: true, selection: false, value: false },
  assertText: { target: true, selection: false, value: true },
  assertValue: { target: true, selection: false, value: true },
  assertChecked: { target: true, selection: false, value: false },
  assertCount: { target: true, selection: true, value: true },
  assertEnabled: { target: true, selection: false, value: false },
  assertDisabled: { target: true, selection: false, value: false },
  waitFor: { target: true, selection: false, value: false },
};

// Used for any action not present in ACTION_FIELD_CONFIG (safety net for
// future actions added to ACTIONS but not yet configured).
const DEFAULT_FIELD_CONFIG = { target: true, selection: true, value: true };

function getFieldConfig(action) {
  return ACTION_FIELD_CONFIG[action] || DEFAULT_FIELD_CONFIG;
}

/* ==========================================================================
   STATE
   In-memory only, per the spec (no localStorage).

   Steps live in one of three places:
   - `scenario.sharedSteps`: added before any test block exists. Written
     once in the export, not repeated per test. Always plain steps.
   - `scenario.tests[n].steps`: once "+ New Test" has been clicked at least
     once, every "+ Next step" click adds to the MOST RECENTLY created test
     block (the currently "open" envelope). Clicking "+ New Test" again
     closes the current block and opens a new one. This array is MIXED:
     each item is either a plain step, or an assertion block
     (`{ id, assertions: [...] }`). isBlock() tells them apart.
   - `block.assertions`: an assertion block's own list, added to only via
     that block's own local "+ Add assertion" button — never a plain step,
     never a nested test, and never targeted by the global "+ Next step".
     Its action dropdown is restricted to ASSERTION_ACTIONS.

   Each step/test/block also has a live DOM row/block tracked in `rowsById`
   / `testsById` / `blocksById` so fields can be updated in place without
   re-rendering the whole list (which would blow away focus/cursor position
   while typing).
   ========================================================================== */

const scenario = {
  scenarioName: '',
  scenarioDescription: '',
  sharedSteps: [],
  tests: [],
};

let stepIdCounter = 0;
function nextStepId() {
  stepIdCounter += 1;
  return `step-${stepIdCounter}`;
}

let testIdCounter = 0;
function nextTestId() {
  testIdCounter += 1;
  return `test-${testIdCounter}`;
}

let blockIdCounter = 0;
function nextBlockId() {
  blockIdCounter += 1;
  return `block-${blockIdCounter}`;
}

// An item in a test's mixed `steps` array is an assertion block if it has
// an `assertions` array; otherwise it's a plain step (has `action` etc).
function isBlock(item) {
  return Array.isArray(item.assertions);
}

const rowsById = new Map(); // step id -> { el, stepNumberEl, actionSelect, targetInput, selectionSelect, valueInput }
const testsById = new Map(); // test id -> { el, nameInput, listEl }
const blocksById = new Map(); // block id -> { el, listEl, numberEl }

// The container ("+ Next step" target) is always the most recently created
// test's steps, or sharedSteps if no test block exists yet. Assertion
// blocks are never the active container — they're only reachable through
// their own local "+ Add assertion" button.
function getActiveContainer() {
  if (scenario.tests.length > 0) {
    return scenario.tests[scenario.tests.length - 1].steps;
  }
  return scenario.sharedSteps;
}

function getActiveListEl() {
  if (scenario.tests.length > 0) {
    const lastTest = scenario.tests[scenario.tests.length - 1];
    return testsById.get(lastTest.id).listEl;
  }
  return sharedStepsListEl;
}

// Locate which array a plain step belongs to (sharedSteps, a test's
// top-level steps, or an assertion block's assertions), along with its
// index, the DOM list it renders into, and how to renumber that container
// after a change. Blocks themselves are located via findBlockContainer.
function findStepContainer(stepId) {
  let index = scenario.sharedSteps.findIndex((s) => s.id === stepId);
  if (index !== -1) {
    return {
      array: scenario.sharedSteps,
      index,
      listEl: sharedStepsListEl,
      renumber: () => renumberSteps(scenario.sharedSteps),
    };
  }

  for (const test of scenario.tests) {
    index = test.steps.findIndex((item) => !isBlock(item) && item.id === stepId);
    if (index !== -1) {
      return {
        array: test.steps,
        index,
        listEl: testsById.get(test.id).listEl,
        renumber: () => renumberTestSteps(test),
      };
    }

    for (const item of test.steps) {
      if (!isBlock(item)) continue;
      const assertionIndex = item.assertions.findIndex((s) => s.id === stepId);
      if (assertionIndex !== -1) {
        return {
          array: item.assertions,
          index: assertionIndex,
          listEl: blocksById.get(item.id).listEl,
          renumber: () => renumberSteps(item.assertions),
        };
      }
    }
  }

  return null;
}

// Locate which test a given assertion block belongs to, along with its
// index in that test's mixed steps array and how to renumber it.
function findBlockContainer(blockId) {
  for (const test of scenario.tests) {
    const index = test.steps.findIndex((item) => isBlock(item) && item.id === blockId);
    if (index !== -1) {
      return {
        array: test.steps,
        index,
        listEl: testsById.get(test.id).listEl,
        renumber: () => renumberTestSteps(test),
      };
    }
  }
  return null;
}

/* ==========================================================================
   DOM REFS
   ========================================================================== */

const scenarioNameInput = document.getElementById('scenario-name');
const scenarioDescriptionInput = document.getElementById('scenario-description');
const sharedStepsListEl = document.getElementById('shared-steps-list');
const testsContainerEl = document.getElementById('tests-container');
const addStepBtn = document.getElementById('add-step-btn');
const addTestBtn = document.getElementById('add-test-btn');
const rowTemplate = document.getElementById('step-row-template');
const testBlockTemplate = document.getElementById('test-block-template');
const assertionBlockTemplate = document.getElementById('assertion-block-template');
const jsonPreviewEl = document.getElementById('json-preview');
const downloadJsonBtn = document.getElementById('download-json-btn');
const copyJsonBtn = document.getElementById('copy-json-btn');
const copyFeedbackEl = document.getElementById('copy-feedback');
const clearAllBtn = document.getElementById('clear-all-btn');
const clearConfirmDialog = document.getElementById('clear-confirm-dialog');
const clearConfirmBtn = document.getElementById('clear-confirm-btn');
const clearCancelBtn = document.getElementById('clear-cancel-btn');

/* ==========================================================================
   RENDER FUNCTIONS
   ========================================================================== */

function buildActionOptions(selectEl, actionsList = ACTIONS) {
  for (const action of actionsList) {
    const opt = document.createElement('option');
    opt.value = action;
    opt.textContent = action;
    selectEl.appendChild(opt);
  }
}

// Show/hide a row's target/selection/value fields based on its action.
function applyFieldVisibility(refs, action) {
  const config = getFieldConfig(action);
  refs.targetInput.hidden = !config.target;
  refs.selectionSelect.hidden = !config.selection;
  refs.valueInput.hidden = !config.value;
}

// Create a DOM row for a step, wire up its listeners, and insert it.
// Does not touch scenario state or append to a container — caller does that.
//
// `context` describes what container this row lives in, since that varies
// (sharedSteps, a test's mixed steps, or a block's assertions-only list):
//   - actionsList: which actions the row's dropdown offers (ACTIONS, or
//     ASSERTION_ACTIONS inside a block)
//   - isLastRow(): whether this row is currently the last one in its
//     container, checked live since containers change as rows are added
//   - onEnterAdd(): what Enter-in-the-last-row should do (add a step to
//     the active container, or add an assertion to this specific block)
function createRowElement(step, context) {
  const fragment = rowTemplate.content.cloneNode(true);
  const rowEl = fragment.querySelector('.step-row');
  rowEl.dataset.stepId = step.id;

  const stepNumberEl = rowEl.querySelector('.step-number');
  const actionSelect = rowEl.querySelector('.field-action');
  const targetInput = rowEl.querySelector('.field-target');
  const selectionSelect = rowEl.querySelector('.field-selection');
  const valueInput = rowEl.querySelector('.field-value');
  const moveUpBtn = rowEl.querySelector('.btn-move-up');
  const moveDownBtn = rowEl.querySelector('.btn-move-down');
  const removeBtn = rowEl.querySelector('.btn-remove');

  buildActionOptions(actionSelect, context.actionsList);
  actionSelect.value = step.action;
  targetInput.value = step.target;
  selectionSelect.value = step.selection || 'single';
  valueInput.value = step.value;

  const refs = {
    el: rowEl,
    stepNumberEl,
    actionSelect,
    targetInput,
    selectionSelect,
    valueInput,
  };

  applyFieldVisibility(refs, step.action);

  // --- field change handlers: update the data model directly, no re-render ---
  actionSelect.addEventListener('change', () => {
    step.action = actionSelect.value;
    const config = getFieldConfig(step.action);
    // Clear values for fields that no longer apply so stale data isn't exported.
    if (!config.target) { step.target = ''; targetInput.value = ''; }
    if (!config.selection) {
      // null (not "single") makes it unambiguous that selection doesn't apply
      // to this action, rather than looking like a real single-select choice.
      step.selection = null;
    } else if (step.selection === null) {
      step.selection = 'single';
      selectionSelect.value = 'single';
    }
    if (!config.value) { step.value = ''; valueInput.value = ''; }
    applyFieldVisibility(refs, step.action);
    updateJsonPreview();
  });

  targetInput.addEventListener('input', () => {
    step.target = targetInput.value;
    updateJsonPreview();
  });

  selectionSelect.addEventListener('change', () => {
    step.selection = selectionSelect.value;
    updateJsonPreview();
  });

  valueInput.addEventListener('input', () => {
    step.value = valueInput.value;
    updateJsonPreview();
  });

  // Enter key in any field of the LAST row adds a new row (per spec).
  // What "last row" and "add" mean depend on context: for a top-level row
  // it's the last row of the currently active container; for a row inside
  // an assertion block it's always that block's own last assertion.
  for (const field of [targetInput, valueInput, actionSelect, selectionSelect]) {
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!context.isLastRow()) return;
      e.preventDefault();
      context.onEnterAdd();
    });
  }

  // --- row controls ---
  moveUpBtn.addEventListener('click', () => moveStep(step.id, -1));
  moveDownBtn.addEventListener('click', () => moveStep(step.id, 1));
  removeBtn.addEventListener('click', () => removeStep(step.id));

  rowsById.set(step.id, refs);
  return rowEl;
}

// Re-labels the "N." prefix on every row in one flat, steps-only container
// (sharedSteps or a single assertion block's assertions) to match its
// current order, and enables/disables that container's move-up / move-down
// buttons at its own ends. Numbering restarts at 1 in each container, since
// each one reads as its own list.
function renumberSteps(stepsArray) {
  stepsArray.forEach((step, index) => {
    const refs = rowsById.get(step.id);
    if (!refs) return;
    refs.stepNumberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === stepsArray.length - 1;
  });
}

// Same idea, but for a test's mixed steps array (plain steps interleaved
// with assertion blocks) — numbers both kinds of item in one sequence.
function renumberTestSteps(test) {
  test.steps.forEach((item, index) => {
    const refs = isBlock(item) ? blocksById.get(item.id) : rowsById.get(item.id);
    if (!refs) return;
    const numberEl = isBlock(item) ? refs.numberEl : refs.stepNumberEl;
    numberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === test.steps.length - 1;
  });
}

function updateJsonPreview() {
  jsonPreviewEl.textContent = JSON.stringify(buildExportObject(), null, 2);
}

/* ==========================================================================
   STEP OPERATIONS (add / remove / reorder)
   These are the only operations that touch DOM structure (insert/remove/
   move row elements); field edits above mutate in place instead.
   ========================================================================== */

// Adds a step to the currently active container (see getActiveContainer):
// sharedSteps until a test block exists, then the most recently opened test.
function addStep({ focus = false } = {}) {
  const initialAction = ACTIONS[0];
  const config = getFieldConfig(initialAction);
  const step = {
    id: nextStepId(),
    action: initialAction,
    target: '',
    selection: config.selection ? 'single' : null,
    value: '',
  };

  const activeArray = getActiveContainer();
  const activeListEl = getActiveListEl();
  activeArray.push(step);

  const rowEl = createRowElement(step, {
    actionsList: ACTIONS,
    isLastRow: () => {
      const arr = getActiveContainer();
      return arr[arr.length - 1] === step;
    },
    onEnterAdd: () => addStep({ focus: true }),
  });
  activeListEl.appendChild(rowEl);

  if (scenario.tests.length > 0) {
    renumberTestSteps(scenario.tests[scenario.tests.length - 1]);
  } else {
    renumberSteps(scenario.sharedSteps);
  }

  updateJsonPreview();

  if (focus) {
    rowsById.get(step.id).actionSelect.focus();
  }

  return step;
}

function removeStep(stepId) {
  const container = findStepContainer(stepId);
  if (!container) return;
  const { array, index } = container;

  array.splice(index, 1);

  const refs = rowsById.get(stepId);
  if (refs) {
    refs.el.remove();
    rowsById.delete(stepId);
  }

  container.renumber();
  updateJsonPreview();
}

function moveStep(stepId, direction) {
  const container = findStepContainer(stepId);
  if (!container) return;
  const { array, index, listEl } = container;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= array.length) return;

  // Swap in the data array.
  const [step] = array.splice(index, 1);
  array.splice(newIndex, 0, step);

  // Swap in the DOM to match.
  const refs = rowsById.get(stepId);
  if (direction < 0) {
    listEl.insertBefore(refs.el, refs.el.previousElementSibling);
  } else {
    const nextSibling = refs.el.nextElementSibling;
    if (nextSibling) listEl.insertBefore(nextSibling, refs.el);
  }

  container.renumber();
  updateJsonPreview();
}

/* ==========================================================================
   TEST BLOCK OPERATIONS
   A test block is a named envelope that owns its own steps array + DOM
   list. Creating one changes what getActiveContainer() returns, so all
   subsequent "+ Next step" / Enter-to-add-row calls target it instead of
   sharedSteps.
   ========================================================================== */

function createTestBlockElement(test) {
  const fragment = testBlockTemplate.content.cloneNode(true);
  const blockEl = fragment.querySelector('.test-block');
  blockEl.dataset.testId = test.id;

  const nameInput = blockEl.querySelector('.test-name-input');
  const removeBtn = blockEl.querySelector('.btn-remove-test');
  const listEl = blockEl.querySelector('.test-steps-list');
  const addAssertionBlockBtn = blockEl.querySelector('.btn-add-assertion-block');

  nameInput.value = test.name;
  nameInput.addEventListener('input', () => {
    test.name = nameInput.value;
    updateJsonPreview();
  });

  removeBtn.addEventListener('click', () => removeTest(test.id));
  addAssertionBlockBtn.addEventListener('click', () => addAssertionBlock(test));

  testsById.set(test.id, { el: blockEl, nameInput, listEl });
  return blockEl;
}

function addTest({ focus = false } = {}) {
  const test = {
    id: nextTestId(),
    name: `Test#${scenario.tests.length + 1}`,
    steps: [],
  };
  scenario.tests.push(test);

  const blockEl = createTestBlockElement(test);
  testsContainerEl.appendChild(blockEl);

  updateJsonPreview();

  if (focus) {
    testsById.get(test.id).nameInput.focus();
  }

  return test;
}

function removeTest(testId) {
  const index = scenario.tests.findIndex((t) => t.id === testId);
  if (index === -1) return;

  const [test] = scenario.tests.splice(index, 1);
  for (const item of test.steps) {
    if (isBlock(item)) {
      for (const assertion of item.assertions) {
        rowsById.delete(assertion.id);
      }
      blocksById.delete(item.id);
    } else {
      rowsById.delete(item.id);
    }
  }

  const refs = testsById.get(testId);
  if (refs) {
    refs.el.remove();
    testsById.delete(testId);
  }

  updateJsonPreview();
}

/* ==========================================================================
   ASSERTION BLOCK OPERATIONS
   An assertion block is a leaf envelope living inside a test's mixed steps
   array. It's never the "active container" for the global "+ Next step" —
   it only grows through its own local "+ Add assertion" button, and it can
   only ever hold assertions (ASSERTION_ACTIONS), never a plain step or a
   nested test.
   ========================================================================== */

function createBlockElement(block) {
  const fragment = assertionBlockTemplate.content.cloneNode(true);
  const blockEl = fragment.querySelector('.assertion-block');
  blockEl.dataset.blockId = block.id;

  const numberEl = blockEl.querySelector('.assertion-block-number');
  const listEl = blockEl.querySelector('.assertion-block-steps-list');
  const addAssertionBtn = blockEl.querySelector('.btn-add-assertion');
  const moveUpBtn = blockEl.querySelector('.btn-move-up');
  const moveDownBtn = blockEl.querySelector('.btn-move-down');
  const removeBtn = blockEl.querySelector('.btn-remove-block');

  addAssertionBtn.addEventListener('click', () => addAssertionToBlock(block, { focus: true }));
  moveUpBtn.addEventListener('click', () => moveBlock(block.id, -1));
  moveDownBtn.addEventListener('click', () => moveBlock(block.id, 1));
  removeBtn.addEventListener('click', () => removeBlock(block.id));

  blocksById.set(block.id, { el: blockEl, listEl, numberEl });
  return blockEl;
}

// Appends a new, empty assertion block to the end of one test's steps.
function addAssertionBlock(test) {
  const block = { id: nextBlockId(), assertions: [] };
  test.steps.push(block);

  const blockEl = createBlockElement(block);
  testsById.get(test.id).listEl.appendChild(blockEl);

  renumberTestSteps(test);
  updateJsonPreview();

  return block;
}

function removeBlock(blockId) {
  const container = findBlockContainer(blockId);
  if (!container) return;
  const { array, index } = container;

  const [block] = array.splice(index, 1);
  for (const assertion of block.assertions) {
    rowsById.delete(assertion.id);
  }

  const refs = blocksById.get(blockId);
  if (refs) {
    refs.el.remove();
    blocksById.delete(blockId);
  }

  container.renumber();
  updateJsonPreview();
}

function moveBlock(blockId, direction) {
  const container = findBlockContainer(blockId);
  if (!container) return;
  const { array, index, listEl } = container;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= array.length) return;

  const [block] = array.splice(index, 1);
  array.splice(newIndex, 0, block);

  const refs = blocksById.get(blockId);
  if (direction < 0) {
    listEl.insertBefore(refs.el, refs.el.previousElementSibling);
  } else {
    const nextSibling = refs.el.nextElementSibling;
    if (nextSibling) listEl.insertBefore(nextSibling, refs.el);
  }

  container.renumber();
  updateJsonPreview();
}

// Adds an assertion row to one specific block. Always targets that block,
// regardless of which test is "active" — blocks manage their own append.
function addAssertionToBlock(block, { focus = false } = {}) {
  const initialAction = ASSERTION_ACTIONS[0];
  const config = getFieldConfig(initialAction);
  const step = {
    id: nextStepId(),
    action: initialAction,
    target: '',
    selection: config.selection ? 'single' : null,
    value: '',
  };
  block.assertions.push(step);

  const rowEl = createRowElement(step, {
    actionsList: ASSERTION_ACTIONS,
    isLastRow: () => block.assertions[block.assertions.length - 1] === step,
    onEnterAdd: () => addAssertionToBlock(block, { focus: true }),
  });
  blocksById.get(block.id).listEl.appendChild(rowEl);

  renumberSteps(block.assertions);
  updateJsonPreview();

  if (focus) {
    rowsById.get(step.id).actionSelect.focus();
  }

  return step;
}

/* ==========================================================================
   RESET
   ========================================================================== */

// Wipes scenario name/description, shared steps, and all test blocks back
// to the same state the app starts in (one empty step, no tests, no name).
function clearAll() {
  scenario.scenarioName = '';
  scenarioNameInput.value = '';

  scenario.scenarioDescription = '';
  scenarioDescriptionInput.value = '';

  scenario.sharedSteps = [];
  sharedStepsListEl.innerHTML = '';

  scenario.tests = [];
  testsContainerEl.innerHTML = '';

  rowsById.clear();
  testsById.clear();
  blocksById.clear();

  addStep(); // restore the single starting row, matching initial load
  updateJsonPreview();
}

/* ==========================================================================
   EXPORT FUNCTIONS
   ========================================================================== */

function exportStep(s) {
  return {
    id: s.id,
    action: s.action,
    target: s.target,
    selection: s.selection,
    value: s.value,
  };
}

// Exports one item from a test's mixed steps array: a plain step as-is, or
// an assertion block as { id, assertions: [...] } — the presence of
// `assertions` is what marks it as a block on the way out too.
function exportTestStepsItem(item) {
  if (isBlock(item)) {
    return { id: item.id, assertions: item.assertions.map(exportStep) };
  }
  return exportStep(item);
}

function buildExportObject() {
  const base = {
    scenarioName: scenario.scenarioName,
    scenarioDescription: scenario.scenarioDescription,
  };

  // sharedSteps/tests only make sense once there's an actual branch to
  // represent (2+ test blocks). With 0 or 1 test blocks there's nothing to
  // share between, so export a single flat `steps` list instead.
  if (scenario.tests.length > 1) {
    return {
      ...base,
      sharedSteps: scenario.sharedSteps.map(exportStep),
      tests: scenario.tests.map((t) => ({
        id: t.id,
        name: t.name,
        steps: t.steps.map(exportTestStepsItem),
      })),
    };
  }

  const flatSteps = scenario.tests.length === 1
    ? [...scenario.sharedSteps, ...scenario.tests[0].steps]
    : scenario.sharedSteps;

  return {
    ...base,
    steps: flatSteps.map(exportTestStepsItem),
  };
}

function downloadJson() {
  const json = JSON.stringify(buildExportObject(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const nameSlug = (scenario.scenarioName || 'test-scenario')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'test-scenario';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${nameSlug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyJsonToClipboard() {
  const json = JSON.stringify(buildExportObject(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    showCopyFeedback('Copied!');
  } catch (err) {
    showCopyFeedback('Copy failed');
  }
}

let copyFeedbackTimer = null;
function showCopyFeedback(message) {
  copyFeedbackEl.textContent = message;
  clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    copyFeedbackEl.textContent = '';
  }, 1800);
}

/* ==========================================================================
   EVENT HANDLERS (top-level)
   ========================================================================== */

scenarioNameInput.addEventListener('input', () => {
  scenario.scenarioName = scenarioNameInput.value;
  updateJsonPreview();
});

scenarioDescriptionInput.addEventListener('input', () => {
  scenario.scenarioDescription = scenarioDescriptionInput.value;
  updateJsonPreview();
});

addStepBtn.addEventListener('click', () => addStep({ focus: true }));
addTestBtn.addEventListener('click', () => addTest({ focus: true }));

downloadJsonBtn.addEventListener('click', downloadJson);
copyJsonBtn.addEventListener('click', copyJsonToClipboard);

clearAllBtn.addEventListener('click', () => {
  clearConfirmDialog.showModal();
});

clearCancelBtn.addEventListener('click', () => {
  clearConfirmDialog.close();
});

clearConfirmBtn.addEventListener('click', () => {
  clearAll();
  clearConfirmDialog.close();
});

/* ==========================================================================
   INIT
   ========================================================================== */

function init() {
  addStep(); // start with one empty step row, per the data model
  updateJsonPreview();
}

init();
