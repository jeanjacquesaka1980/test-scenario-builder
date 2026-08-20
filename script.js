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

// Actions allowed inside an assertion block — only assertions belong there.
const ASSERTION_ACTIONS = ACTIONS.filter((action) => action.startsWith('assert'));

// Actions allowed inside a step block — the complement of the above, so a
// step block can never hold an assertion (that's what assertion blocks are
// for — the two are deliberately mutually exclusive).
const STEP_ACTIONS = ACTIONS.filter((action) => !action.startsWith('assert'));

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

   Vocabulary:
   - A "step" is one leaf row: one action (which may itself be an assertion
     like assertVisible — an assertion is just a step whose action happens
     to assert something).
   - A "block" groups several steps under one heading — in export terms,
     one block is one test.step() call wrapping several actions, same as a
     standalone step is one test.step() call wrapping a single action.
     Shape: { id, kind: 'step' | 'assertion', actions: [...] }. `kind` is
     what the BUILDER uses to restrict which actions the block accepts
     (STEP_ACTIONS for 'step', ASSERTION_ACTIONS for 'assertion') and which
     template/theme to render — it's a builder-only concern, dropped on
     export, since each action already self-describes via its own `action`
     field (an agent reading the export doesn't need the block's kind, only
     what's inside it). Blocks don't nest — a block's own list is always
     flat steps, never another block.
   - A "test" is the one named, top-level container (`scenario.tests[n]`).

   Both `scenario.sharedSteps` and every `test.steps` are MIXED arrays: each
   item is either a plain step or a block. They're structurally identical —
   the only thing special about a test is that it's named and lives in
   `scenario.tests` rather than being the implicit top-level list.

   The "active container" (what "+ Next step" / "+ Step block" /
   "+ Assertion block" / Enter-to-add-row all target) is sharedSteps until
   the first "+ New Test" click, then always the most recently created test.
   A block is never the active container — it only grows through its own
   local "+ Add" button, regardless of which test is currently active.

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

function isAnyBlock(item) {
  return Array.isArray(item.actions);
}

function isStepBlock(item) {
  return isAnyBlock(item) && item.kind === 'step';
}

function blockActionsList(block) {
  return block.kind === 'assertion' ? ASSERTION_ACTIONS : STEP_ACTIONS;
}

const rowsById = new Map(); // step id -> { el, stepNumberEl, actionSelect, targetInput, selectionSelect, valueInput }
const testsById = new Map(); // test id -> { el, nameInput, listEl }
const blocksById = new Map(); // block id -> { el, listEl, numberEl }

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

// Every mixed container (sharedSteps, or one test's steps) paired with its
// DOM list element — used to search across all of them uniformly.
function allMixedContainers() {
  const containers = [{ array: scenario.sharedSteps, listEl: sharedStepsListEl }];
  for (const test of scenario.tests) {
    containers.push({ array: test.steps, listEl: testsById.get(test.id).listEl });
  }
  return containers;
}

// Locate which array a plain step belongs to (a mixed container's top
// level, or a block's own items), along with its index, the DOM list it
// renders into, and how to renumber that container after a change.
function findStepContainer(stepId) {
  for (const { array, listEl } of allMixedContainers()) {
    const index = array.findIndex((item) => !isAnyBlock(item) && item.id === stepId);
    if (index !== -1) {
      return { array, index, listEl, renumber: () => renumberItems(array) };
    }

    for (const item of array) {
      if (!isAnyBlock(item)) continue;
      const items = item.actions;
      const itemIndex = items.findIndex((s) => s.id === stepId);
      if (itemIndex !== -1) {
        return {
          array: items,
          index: itemIndex,
          listEl: blocksById.get(item.id).listEl,
          renumber: () => renumberSteps(items),
        };
      }
    }
  }

  return null;
}

// Locate which mixed container a given block belongs to (blocks only ever
// live at a container's top level — they don't nest).
function findBlockContainer(blockId) {
  for (const { array, listEl } of allMixedContainers()) {
    const index = array.findIndex((item) => isAnyBlock(item) && item.id === blockId);
    if (index !== -1) {
      return { array, index, listEl, renumber: () => renumberItems(array) };
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
const addStepBlockBtn = document.getElementById('add-step-block-btn');
const addAssertionBlockBtn = document.getElementById('add-assertion-block-btn');
const addTestBtn = document.getElementById('add-test-btn');
const rowTemplate = document.getElementById('step-row-template');
const testBlockTemplate = document.getElementById('test-block-template');
const stepBlockTemplate = document.getElementById('step-block-template');
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
// (sharedSteps, a test's mixed steps, or a block's own items):
//   - actionsList: which actions the row's dropdown offers (ACTIONS,
//     STEP_ACTIONS, or ASSERTION_ACTIONS)
//   - isLastRow(): whether this row is currently the last one in its
//     container, checked live since containers change as rows are added
//   - onEnterAdd(): what Enter-in-the-last-row should do (add a step to
//     the active container, or add an item to this specific block)
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
  // a block it's always that block's own last item.
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
// (a single block's own items) to match its current order, and
// enables/disables that container's move-up / move-down buttons at its own
// ends. Numbering restarts at 1 in each container, since each one reads as
// its own list.
function renumberSteps(stepsArray) {
  stepsArray.forEach((step, index) => {
    const refs = rowsById.get(step.id);
    if (!refs) return;
    refs.stepNumberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === stepsArray.length - 1;
  });
}

// Same idea, but for a mixed container (sharedSteps or one test's steps) —
// numbers plain steps and blocks together in one sequence.
function renumberItems(itemsArray) {
  itemsArray.forEach((item, index) => {
    const refs = isAnyBlock(item) ? blocksById.get(item.id) : rowsById.get(item.id);
    if (!refs) return;
    const numberEl = isAnyBlock(item) ? refs.numberEl : refs.stepNumberEl;
    numberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === itemsArray.length - 1;
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
// sharedSteps until a test exists, then the most recently created test.
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

  renumberItems(activeArray);
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
   TEST OPERATIONS
   A test is a named envelope that owns its own mixed steps array + DOM
   list. Creating one changes what getActiveContainer() returns, so all
   subsequent "+ Next step" / "+ Step block" / "+ Assertion block" /
   Enter-to-add-row calls target it instead of sharedSteps.
   ========================================================================== */

function createTestBlockElement(test) {
  const fragment = testBlockTemplate.content.cloneNode(true);
  const blockEl = fragment.querySelector('.test-block');
  blockEl.dataset.testId = test.id;

  const nameInput = blockEl.querySelector('.test-name-input');
  const removeBtn = blockEl.querySelector('.btn-remove-test');
  const listEl = blockEl.querySelector('.test-steps-list');

  nameInput.value = test.name;
  nameInput.addEventListener('input', () => {
    test.name = nameInput.value;
    updateJsonPreview();
  });

  removeBtn.addEventListener('click', () => removeTest(test.id));

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

// Removes every rowsById/blocksById entry for one mixed container's items,
// recursing one level into any block's own items. Used when a test (or, in
// clearAll, everything) is torn down.
function cleanupMixedItems(itemsArray) {
  for (const item of itemsArray) {
    if (isAnyBlock(item)) {
      for (const nested of item.actions) {
        rowsById.delete(nested.id);
      }
      blocksById.delete(item.id);
    } else {
      rowsById.delete(item.id);
    }
  }
}

function removeTest(testId) {
  const index = scenario.tests.findIndex((t) => t.id === testId);
  if (index === -1) return;

  const [test] = scenario.tests.splice(index, 1);
  cleanupMixedItems(test.steps);

  const refs = testsById.get(testId);
  if (refs) {
    refs.el.remove();
    testsById.delete(testId);
  }

  updateJsonPreview();
}

/* ==========================================================================
   BLOCK OPERATIONS
   A block (step block or assertion block) is a leaf envelope living at the
   top level of a mixed container (sharedSteps or a test's steps) — never
   nested inside another block. It's never the "active container" for the
   global add buttons; it only grows through its own local "+ Add" button,
   and a step block can only ever hold STEP_ACTIONS while an assertion
   block can only ever hold ASSERTION_ACTIONS.
   ========================================================================== */

function createBlockElement(block) {
  const template = isStepBlock(block) ? stepBlockTemplate : assertionBlockTemplate;
  const fragment = template.content.cloneNode(true);
  const blockEl = fragment.querySelector('.block');
  blockEl.dataset.blockId = block.id;

  const numberEl = blockEl.querySelector('.block-number');
  const listEl = blockEl.querySelector('.block-steps-list');
  const addItemBtn = blockEl.querySelector('.btn-add-item');
  const moveUpBtn = blockEl.querySelector('.btn-move-up');
  const moveDownBtn = blockEl.querySelector('.btn-move-down');
  const removeBtn = blockEl.querySelector('.btn-remove-block');

  addItemBtn.addEventListener('click', () => addItemToBlock(block, { focus: true }));
  moveUpBtn.addEventListener('click', () => moveBlock(block.id, -1));
  moveDownBtn.addEventListener('click', () => moveBlock(block.id, 1));
  removeBtn.addEventListener('click', () => removeBlock(block.id));

  blocksById.set(block.id, { el: blockEl, listEl, numberEl });
  return blockEl;
}

// Appends a new, empty block to the currently active container (same
// active-container rule as "+ Next step" / "+ New Test").
function insertBlockIntoActiveContainer(block) {
  const activeArray = getActiveContainer();
  const activeListEl = getActiveListEl();
  activeArray.push(block);

  const blockEl = createBlockElement(block);
  activeListEl.appendChild(blockEl);

  renumberItems(activeArray);
  updateJsonPreview();

  return block;
}

function addStepBlock() {
  return insertBlockIntoActiveContainer({ id: nextBlockId(), kind: 'step', actions: [] });
}

function addAssertionBlock() {
  return insertBlockIntoActiveContainer({ id: nextBlockId(), kind: 'assertion', actions: [] });
}

function removeBlock(blockId) {
  const container = findBlockContainer(blockId);
  if (!container) return;
  const { array, index } = container;

  const [block] = array.splice(index, 1);
  for (const item of block.actions) {
    rowsById.delete(item.id);
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

// Adds an item (a step or an assertion, depending on the block's kind) to
// one specific block. Always targets that block, regardless of which test
// is "active" — blocks manage their own append.
function addItemToBlock(block, { focus = false } = {}) {
  const actionsList = blockActionsList(block);
  const items = block.actions;
  const initialAction = actionsList[0];
  const config = getFieldConfig(initialAction);
  const step = {
    id: nextStepId(),
    action: initialAction,
    target: '',
    selection: config.selection ? 'single' : null,
    value: '',
  };
  items.push(step);

  const rowEl = createRowElement(step, {
    actionsList,
    isLastRow: () => items[items.length - 1] === step,
    onEnterAdd: () => addItemToBlock(block, { focus: true }),
  });
  blocksById.get(block.id).listEl.appendChild(rowEl);

  renumberSteps(items);
  updateJsonPreview();

  if (focus) {
    rowsById.get(step.id).actionSelect.focus();
  }

  return step;
}

/* ==========================================================================
   RESET
   ========================================================================== */

// Wipes scenario name/description, shared steps, and all tests back to the
// same state the app starts in (one empty step, no tests, no name).
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

// Exports one item from a mixed container: a standalone step exports bare
// (same shape as exportStep — one test.step() call wrapping one action),
// while ANY block — step block or assertion block alike — exports as
// { id, actions: [...] } (one test.step() call wrapping several actions).
// The block's kind (which restricts what the builder let you put in it)
// is deliberately dropped here: it's a builder-only concern, and each
// action already says what it is via its own `action` field.
function exportItem(item) {
  if (isAnyBlock(item)) {
    return { id: item.id, actions: item.actions.map(exportStep) };
  }
  return exportStep(item);
}

function buildExportObject() {
  const base = {
    scenarioName: scenario.scenarioName,
    scenarioDescription: scenario.scenarioDescription,
  };

  // sharedSteps/tests only make sense once there's an actual branch to
  // represent (2+ tests). With 0 or 1 tests there's nothing to share
  // between, so export a single flat `steps` list instead.
  if (scenario.tests.length > 1) {
    return {
      ...base,
      sharedSteps: scenario.sharedSteps.map(exportItem),
      tests: scenario.tests.map((t) => ({
        id: t.id,
        name: t.name,
        steps: t.steps.map(exportItem),
      })),
    };
  }

  const flatSteps = scenario.tests.length === 1
    ? [...scenario.sharedSteps, ...scenario.tests[0].steps]
    : scenario.sharedSteps;

  return {
    ...base,
    steps: flatSteps.map(exportItem),
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
addStepBlockBtn.addEventListener('click', () => addStepBlock());
addAssertionBlockBtn.addEventListener('click', () => addAssertionBlock());
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
