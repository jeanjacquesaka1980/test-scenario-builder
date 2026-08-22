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

// Actions allowed inside an Assertion — only assertions belong there.
const ASSERTION_ACTIONS = ACTIONS.filter((action) => action.startsWith('assert'));

// Actions allowed inside an Action — the complement of the above, so an
// Action can never hold an assertion (that's what an Assertion is for —
// the two are deliberately mutually exclusive).
const REGULAR_ACTIONS = ACTIONS.filter((action) => !action.startsWith('assert'));

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

   Vocabulary (UI-facing — the JSON export doesn't have to mirror this):
   - An "Action" is a group of one or more regular (non-assert) actions.
   - An "Assertion" is a group of one or more assertions.
   - A "Test" is the one named, top-level container (`scenario.tests[n]`).
   Every entry the user adds is always one of these three — there's no bare,
   ungrouped row. Shape: { id, kind: 'action' | 'assertion', actions: [...] }.
   `kind` restricts which actions the group accepts (REGULAR_ACTIONS for
   'action', ASSERTION_ACTIONS for 'assertion') and which template/theme to
   render. Groups don't nest — a group's own list is always flat leaf rows.

   `scenario.workflow` and every `test.steps` hold ONLY Action/Assertion
   groups — never a Test (a Test can't nest inside a Test either). The only
   two containers that exist are "workflow" (the implicit root — there's
   exactly one of these in the whole document) and a Test.

   The "active container" (what "+ Action" / "+ Assertion" target) is
   scenario.workflow until the first "+ New Test" click, then always the
   most recently created test. A group is never the active container — it
   only grows through its own local "+ Add" button, regardless of which
   test is currently active.

   Each leaf row/test/group also has a live DOM element tracked in
   `rowsById` / `testsById` / `blocksById` so fields can be updated in place
   without re-rendering the whole list (which would blow away focus/cursor
   position while typing).

   Leaf row ids are prefixed by which kind of group they live in —
   `action-N` inside an Action, `assertion-N` inside an Assertion — using
   one global counter per prefix (not reset per group), so every id in the
   document stays a stable, unique reference regardless of where its group
   gets moved later.
   ========================================================================== */

const scenario = {
  scenarioName: '',
  scenarioDescription: '',
  workflow: [],
  tests: [],
};

let actionIdCounter = 0;
function nextActionId() {
  actionIdCounter += 1;
  return `action-${actionIdCounter}`;
}

let assertionIdCounter = 0;
function nextAssertionId() {
  assertionIdCounter += 1;
  return `assertion-${assertionIdCounter}`;
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

function isActionBlock(item) {
  return item.kind === 'action';
}

function blockActionsList(block) {
  return block.kind === 'assertion' ? ASSERTION_ACTIONS : REGULAR_ACTIONS;
}

const rowsById = new Map(); // leaf row id -> { el, stepNumberEl, actionSelect, targetInput, selectionSelect, valueInput }
const testsById = new Map(); // test id -> { el, nameInput, listEl }
const blocksById = new Map(); // group id -> { el, listEl, numberEl }

function getActiveContainer() {
  if (scenario.tests.length > 0) {
    return scenario.tests[scenario.tests.length - 1].steps;
  }
  return scenario.workflow;
}

function getActiveListEl() {
  if (scenario.tests.length > 0) {
    const lastTest = scenario.tests[scenario.tests.length - 1];
    return testsById.get(lastTest.id).listEl;
  }
  return sharedStepsListEl;
}

// Every top-level container (scenario.workflow, or one test's steps)
// paired with its DOM list element — used to search across all uniformly.
function allTopLevelContainers() {
  const containers = [{ array: scenario.workflow, listEl: sharedStepsListEl }];
  for (const test of scenario.tests) {
    containers.push({ array: test.steps, listEl: testsById.get(test.id).listEl });
  }
  return containers;
}

// Locate which group a leaf row belongs to, along with its index, the DOM
// list it renders into, and how to renumber that group after a change.
function findStepContainer(stepId) {
  for (const { array } of allTopLevelContainers()) {
    for (const group of array) {
      const index = group.actions.findIndex((s) => s.id === stepId);
      if (index !== -1) {
        return {
          array: group.actions,
          index,
          listEl: blocksById.get(group.id).listEl,
          renumber: () => renumberSteps(group.actions),
        };
      }
    }
  }
  return null;
}

// Locate which top-level container a given group belongs to (groups only
// ever live at a container's top level — they don't nest).
function findBlockContainer(blockId) {
  for (const { array, listEl } of allTopLevelContainers()) {
    const index = array.findIndex((item) => item.id === blockId);
    if (index !== -1) {
      return { array, index, listEl, renumber: () => renumberGroups(array) };
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
const addActionBlockBtn = document.getElementById('add-action-block-btn');
const addAssertionBlockBtn = document.getElementById('add-assertion-block-btn');
const addTestBtn = document.getElementById('add-test-btn');
const rowTemplate = document.getElementById('step-row-template');
const testBlockTemplate = document.getElementById('test-block-template');
const actionBlockTemplate = document.getElementById('action-block-template');
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

// Create a DOM row for one leaf action/assertion inside a group, wire up
// its listeners, and insert it. Does not touch scenario state or append to
// a container — caller (addItemToBlock) does that.
//
// `context`:
//   - actionsList: REGULAR_ACTIONS or ASSERTION_ACTIONS, depending on the
//     group's kind
//   - isLastRow(): whether this row is currently the last one in its group,
//     checked live since the group's contents change as rows are added
//   - onEnterAdd(): adds another row to this same group
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

  // Enter key in any field of the LAST row in this group adds another row
  // to the same group (per spec).
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

// Re-labels the "N." prefix on every row inside one group to match its
// current order, and enables/disables that group's move-up / move-down
// buttons at its own ends. Numbering restarts at 1 in each group, since
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

// Same idea, but for a top-level container (scenario.workflow or one
// test's steps) — numbers its Action/Assertion groups in one sequence.
function renumberGroups(groupsArray) {
  groupsArray.forEach((group, index) => {
    const refs = blocksById.get(group.id);
    if (!refs) return;
    refs.numberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === groupsArray.length - 1;
  });
}

function updateJsonPreview() {
  jsonPreviewEl.textContent = JSON.stringify(buildExportObject(), null, 2);
}

/* ==========================================================================
   STEP OPERATIONS (remove / reorder a leaf row within its group)
   These are the only operations that touch DOM structure (insert/remove/
   move row elements); field edits above mutate in place instead.
   ========================================================================== */

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
   A test is a named envelope that owns its own list of Action/Assertion
   groups + DOM list. Creating one changes what getActiveContainer()
   returns, so "+ Action" / "+ Assertion" target it instead of the workflow.
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
    name: 'Test',
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

// Removes every rowsById/blocksById entry for one container's groups (and
// their leaf rows). Used when a test (or, in clearAll, everything) is torn
// down.
function cleanupGroups(groupsArray) {
  for (const group of groupsArray) {
    for (const leaf of group.actions) {
      rowsById.delete(leaf.id);
    }
    blocksById.delete(group.id);
  }
}

function removeTest(testId) {
  const index = scenario.tests.findIndex((t) => t.id === testId);
  if (index === -1) return;

  const [test] = scenario.tests.splice(index, 1);
  cleanupGroups(test.steps);

  const refs = testsById.get(testId);
  if (refs) {
    refs.el.remove();
    testsById.delete(testId);
  }

  updateJsonPreview();
}

/* ==========================================================================
   GROUP OPERATIONS (Action / Assertion)
   A group is a leaf envelope living at the top level of scenario.workflow
   or a test's steps — never nested inside another group. It's never the
   "active container" for the global add buttons; it only grows through its
   own local "+ Add" button, and an Action can only ever hold
   REGULAR_ACTIONS while an Assertion can only ever hold ASSERTION_ACTIONS.
   ========================================================================== */

function createBlockElement(block) {
  const template = isActionBlock(block) ? actionBlockTemplate : assertionBlockTemplate;
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

// Appends a new, empty group to the currently active container (same
// active-container rule as "+ New Test").
function insertBlockIntoActiveContainer(block) {
  const activeArray = getActiveContainer();
  const activeListEl = getActiveListEl();
  activeArray.push(block);

  const blockEl = createBlockElement(block);
  activeListEl.appendChild(blockEl);

  renumberGroups(activeArray);
  updateJsonPreview();

  return block;
}

function addActionBlock() {
  return insertBlockIntoActiveContainer({ id: nextBlockId(), kind: 'action', actions: [] });
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

// Adds a leaf row (an action or an assertion, depending on the group's
// kind) to one specific group. Always targets that group, regardless of
// which test is "active" — groups manage their own append.
function addItemToBlock(block, { focus = false } = {}) {
  const actionsList = blockActionsList(block);
  const items = block.actions;
  const initialAction = actionsList[0];
  const config = getFieldConfig(initialAction);
  const step = {
    id: isActionBlock(block) ? nextActionId() : nextAssertionId(),
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
// same empty state the app starts in.
function clearAll() {
  scenario.scenarioName = '';
  scenarioNameInput.value = '';

  scenario.scenarioDescription = '';
  scenarioDescriptionInput.value = '';

  scenario.workflow = [];
  sharedStepsListEl.innerHTML = '';

  scenario.tests = [];
  testsContainerEl.innerHTML = '';

  rowsById.clear();
  testsById.clear();
  blocksById.clear();

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

// Exports one group as { id, actions: [...] } — one test.step() call
// wrapping its leaf rows. The group's kind (which restricts what the
// builder let you put in it) is deliberately dropped here: it's a
// builder-only concern, and each leaf row already says what it is via its
// own `action` field.
function exportItem(item) {
  return { id: item.id, actions: item.actions.map(exportStep) };
}

function buildExportObject() {
  const base = {
    scenarioName: scenario.scenarioName,
    scenarioDescription: scenario.scenarioDescription,
  };

  // A separate `tests` list only makes sense once there's an actual branch
  // to represent (2+ tests). With 0 or 1 tests there's nothing to branch
  // from, so the single test's groups just join the workflow directly.
  if (scenario.tests.length > 1) {
    return {
      ...base,
      workflow: scenario.workflow.map(exportItem),
      tests: scenario.tests.map((t) => ({
        id: t.id,
        name: t.name,
        steps: t.steps.map(exportItem),
      })),
    };
  }

  const flatWorkflow = scenario.tests.length === 1
    ? [...scenario.workflow, ...scenario.tests[0].steps]
    : scenario.workflow;

  return {
    ...base,
    workflow: flatWorkflow.map(exportItem),
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

addActionBlockBtn.addEventListener('click', () => addActionBlock());
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
  updateJsonPreview();
}

init();
