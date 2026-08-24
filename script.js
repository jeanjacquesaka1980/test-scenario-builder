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

// Actions allowed inside an Action (or a shared "Before Each") — the
// complement of the above, so it can never hold an assertion.
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

   This tool only builds Act + Assert — Arrange (setup) is left entirely to
   whatever agent reads the exported JSON. There are exactly two entry
   points, "+ Test" and "+ Tests", and each instantiates a FIXED scaffold
   that can be grown but never fully removed:

   - "+ Test" (repeatable): adds one standalone Test — one Action group +
     one Assertion group. Every click adds another one; each one IS
     removable (unlike the fixed pieces below), since standalone tests
     don't share anything with each other.
   - "+ Tests" (a one-time scaffold, not repeatable): adds a shared
     "Before Each" section (one fixed Action-only group) plus two Test
     entries — mirrors Playwright's one-beforeEach-per-describe rule. The
     first Before Each group and the first two tests can never be removed;
     growth from here on happens through "+ Add test" (more tests), the
     Before Each section's own "+ Action" (more Before Each groups), and
     each test's own "+ Action" / "+ Assertion" (more groups). A new
     Action always inserts right before that test's first Assertion group;
     a new Assertion always appends at the very end — so actions stay
     before assertions no matter how many of each a test ends up with.

   "Test" mode and "Tests" mode can't coexist — picking one while the
   other exists clears it first (with confirmation).

   Shape:
   - scenario.beforeEach: null, or an array of plain Action groups (mode
     'tests' only) — one shared beforeEach, made up of one-or-more Action
     blocks, never an assertion.
   - scenario.tests: array of { title, steps: [...], removable }. A test's
     `steps` is itself an array of groups:
       { kind: 'action' | 'assertion', title, actions: [...], removable }
     `removable` gates both the remove button AND (for groups) whether a
     neighboring group can move into that slot — fixed pieces are also
     fixed in position.
   - Groups don't nest — a group's own list is always flat leaf rows.

   `id`/`kind` fields exist ONLY on the in-memory objects, to let the
   builder track and render things (DOM lookups, template selection,
   restricting which actions a group accepts). They don't survive to
   export — see the EXPORT section below for the exact shape an agent
   actually reads (deliberately not strict JSON).

   Each leaf row/test/group has a live DOM element tracked in `rowsById` /
   `testsById` / `blocksById` so fields can be updated in place without
   re-rendering the whole list (which would blow away focus/cursor position
   while typing).
   ========================================================================== */

const scenario = {
  scenarioName: '',
  scenarioDescription: '',
  mode: null, // null | 'test' | 'tests'
  beforeEach: null,
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

function blockActionsList(block) {
  return block.kind === 'assertion' ? ASSERTION_ACTIONS : REGULAR_ACTIONS;
}

const rowsById = new Map(); // leaf row id -> { el, stepNumberEl, actionSelect, targetInput, selectionSelect, valueInput }
const testsById = new Map(); // test id -> { el, titleInput, listEl }
const blocksById = new Map(); // group/beforeEach id -> { el, listEl, numberEl }

// Locate which flat leaf list a step belongs to — a group's `.actions`,
// whether the group lives under beforeEach or inside a test — along with
// its index, the DOM list it renders into, and how to renumber it after a
// change.
function findStepContainer(stepId) {
  if (scenario.beforeEach) {
    for (const group of scenario.beforeEach) {
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

  for (const test of scenario.tests) {
    for (const group of test.steps) {
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

// Locate which array a given group belongs to — the shared beforeEach
// array, or one test's own `steps` array.
function findBlockContainer(blockId) {
  if (scenario.beforeEach) {
    const index = scenario.beforeEach.findIndex((g) => g.id === blockId);
    if (index !== -1) {
      return {
        array: scenario.beforeEach,
        index,
        listEl: beforeEachListEl,
        renumber: () => renumberGroups(scenario.beforeEach),
      };
    }
  }

  for (const test of scenario.tests) {
    const index = test.steps.findIndex((g) => g.id === blockId);
    if (index !== -1) {
      return {
        array: test.steps,
        index,
        listEl: testsById.get(test.id).listEl,
        renumber: () => renumberGroups(test.steps),
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
const modeTestBtn = document.getElementById('mode-test-btn');
const modeTestsBtn = document.getElementById('mode-tests-btn');
const growTestBtn = document.getElementById('grow-test-btn');
const rowTemplate = document.getElementById('step-row-template');
const testBlockTemplate = document.getElementById('test-block-template');
const actionBlockTemplate = document.getElementById('action-block-template');
const assertionBlockTemplate = document.getElementById('assertion-block-template');
const beforeEachContainerTemplate = document.getElementById('before-each-container-template');
const jsonPreviewEl = document.getElementById('json-preview');
const copyJsonBtn = document.getElementById('copy-json-btn');
const copyFeedbackEl = document.getElementById('copy-feedback');

// Set once the beforeEach container is created (mode 'tests' only) — the
// DOM list the shared beforeEach groups render into.
let beforeEachListEl = null;
const clearAllBtn = document.getElementById('clear-all-btn');
const clearConfirmDialog = document.getElementById('clear-confirm-dialog');
const clearConfirmBtn = document.getElementById('clear-confirm-btn');
const clearCancelBtn = document.getElementById('clear-cancel-btn');
const modeSwitchConfirmDialog = document.getElementById('mode-switch-confirm-dialog');
const modeSwitchMessageEl = document.getElementById('mode-switch-message');
const modeSwitchConfirmBtn = document.getElementById('mode-switch-confirm-btn');
const modeSwitchCancelBtn = document.getElementById('mode-switch-cancel-btn');

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

// Create a DOM row for one leaf action/assertion inside a group (or the
// beforeEach), wire up its listeners, and insert it. Does not touch
// scenario state or append to a container — caller (addItemToBlock) does
// that.
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

// Re-labels the "N." prefix on every row inside one flat leaf list (a
// group's or the beforeEach's own items) to match its current order, and
// enables/disables that list's move-up / move-down buttons at its own
// ends. Numbering restarts at 1 in each list, since each one reads as its
// own sequence.
function renumberSteps(stepsArray) {
  stepsArray.forEach((step, index) => {
    const refs = rowsById.get(step.id);
    if (!refs) return;
    refs.stepNumberEl.textContent = `${index + 1}.`;
    refs.el.querySelector('.btn-move-up').disabled = index === 0;
    refs.el.querySelector('.btn-move-down').disabled = index === stepsArray.length - 1;
  });
}

// Same idea, but for a test's `steps` array of groups.
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
  jsonPreviewEl.textContent = buildExportText();
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

// Adds a leaf row (an action or an assertion, depending on the group's
// kind) to one specific group or the beforeEach. Always targets that one,
// regardless of anything else on the page.
function addItemToBlock(block, { focus = false } = {}) {
  const actionsList = blockActionsList(block);
  const items = block.actions;
  const initialAction = actionsList[0];
  const config = getFieldConfig(initialAction);
  const step = {
    id: block.kind === 'assertion' ? nextAssertionId() : nextActionId(),
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
   GROUP OPERATIONS (Action / Assertion groups inside a Test)
   Every group's REMOVABLE flag gates both its own remove button and
   whether a neighboring group is allowed to move into its slot — a fixed
   group is also fixed in position.
   ========================================================================== */

function createBlockElement(block) {
  const template = block.kind === 'assertion' ? assertionBlockTemplate : actionBlockTemplate;
  const fragment = template.content.cloneNode(true);
  const blockEl = fragment.querySelector('.block');
  blockEl.dataset.blockId = block.id;

  const numberEl = blockEl.querySelector('.block-number');
  const titleInput = blockEl.querySelector('.block-title-input');
  const listEl = blockEl.querySelector('.block-steps-list');
  const addItemBtn = blockEl.querySelector('.btn-add-item');
  const moveUpBtn = blockEl.querySelector('.btn-move-up');
  const moveDownBtn = blockEl.querySelector('.btn-move-down');
  const removeBtn = blockEl.querySelector('.btn-remove-block');

  titleInput.value = block.title;
  titleInput.addEventListener('input', () => {
    block.title = titleInput.value;
    updateJsonPreview();
  });

  addItemBtn.addEventListener('click', () => addItemToBlock(block, { focus: true }));

  if (block.removable === false) {
    moveUpBtn.hidden = true;
    moveDownBtn.hidden = true;
    removeBtn.hidden = true;
  } else {
    moveUpBtn.addEventListener('click', () => moveBlock(block.id, -1));
    moveDownBtn.addEventListener('click', () => moveBlock(block.id, 1));
    removeBtn.addEventListener('click', () => removeBlock(block.id));
  }

  blocksById.set(block.id, { el: blockEl, listEl, numberEl });
  return blockEl;
}

function removeBlock(blockId) {
  const container = findBlockContainer(blockId);
  if (!container) return;
  const { array, index } = container;
  if (array[index].removable === false) return;

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
  if (array[newIndex].removable === false) return; // can't swap into a fixed slot

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

/* ==========================================================================
   TEST OPERATIONS
   ========================================================================== */

function createFixedActionGroup() {
  return { id: nextBlockId(), kind: 'action', title: '', actions: [], removable: false };
}

function createFixedAssertionGroup() {
  return { id: nextBlockId(), kind: 'assertion', title: '', actions: [], removable: false };
}

function createExtraActionGroup() {
  return { id: nextBlockId(), kind: 'action', title: '', actions: [], removable: true };
}

function createExtraAssertionGroup() {
  return { id: nextBlockId(), kind: 'assertion', title: '', actions: [], removable: true };
}

function createTestEntry({ removable }) {
  return {
    id: nextTestId(),
    title: '',
    steps: [createFixedActionGroup(), createFixedAssertionGroup()],
    removable,
  };
}

function createFixedBeforeEachGroup() {
  return { id: nextBlockId(), kind: 'action', title: '', actions: [], removable: false };
}

function createExtraBeforeEachGroup() {
  return { id: nextBlockId(), kind: 'action', title: '', actions: [], removable: true };
}

function createTestElement(test) {
  const fragment = testBlockTemplate.content.cloneNode(true);
  const blockEl = fragment.querySelector('.test-block');
  blockEl.dataset.testId = test.id;

  const titleInput = blockEl.querySelector('.test-title-input');
  const removeBtn = blockEl.querySelector('.btn-remove-test');
  const listEl = blockEl.querySelector('.test-steps-list');
  const addActionBtn = blockEl.querySelector('.btn-add-action-block');
  const addAssertionBtn = blockEl.querySelector('.btn-add-assertion-block');

  titleInput.value = test.title;
  titleInput.addEventListener('input', () => {
    test.title = titleInput.value;
    updateJsonPreview();
  });

  if (test.removable) {
    removeBtn.addEventListener('click', () => removeTest(test.id));
  } else {
    removeBtn.hidden = true;
  }

  testsById.set(test.id, { el: blockEl, titleInput, listEl });

  for (const group of test.steps) {
    listEl.appendChild(createBlockElement(group));
  }
  renumberGroups(test.steps);

  // A new Action always goes right before this test's first Assertion
  // group (or at the end if it somehow has none yet) — keeps every action
  // ahead of every assertion no matter how many of each exist.
  addActionBtn.addEventListener('click', () => {
    const group = createExtraActionGroup();
    let insertAt = test.steps.findIndex((g) => g.kind === 'assertion');
    if (insertAt === -1) insertAt = test.steps.length;
    test.steps.splice(insertAt, 0, group);

    const groupEl = createBlockElement(group);
    const domRefAtIndex = listEl.children[insertAt];
    if (domRefAtIndex) {
      listEl.insertBefore(groupEl, domRefAtIndex);
    } else {
      listEl.appendChild(groupEl);
    }

    renumberGroups(test.steps);
    updateJsonPreview();
  });

  // A new Assertion always appends at the very end.
  addAssertionBtn.addEventListener('click', () => {
    const group = createExtraAssertionGroup();
    test.steps.push(group);
    listEl.appendChild(createBlockElement(group));
    renumberGroups(test.steps);
    updateJsonPreview();
  });

  return blockEl;
}

function removeTest(testId) {
  const index = scenario.tests.findIndex((t) => t.id === testId);
  if (index === -1) return;
  if (scenario.tests[index].removable === false) return;

  const [test] = scenario.tests.splice(index, 1);
  for (const group of test.steps) {
    for (const item of group.actions) {
      rowsById.delete(item.id);
    }
    blocksById.delete(group.id);
  }

  const refs = testsById.get(testId);
  if (refs) {
    refs.el.remove();
    testsById.delete(testId);
  }

  if (scenario.tests.length === 0) {
    scenario.mode = null;
    updateModeButtonsVisibility();
  }

  updateJsonPreview();
}

// Renders the one shared "Before Each" section: a single labeled envelope
// holding one-or-more plain Action blocks (the first fixed, any extra
// ones removable), each an ordinary Action block — never itself labeled
// "Before Each". Its own local "+ Action" button always appends a new
// Action block at the end; there's no Assertion side since beforeEach
// never holds assertions.
function createBeforeEachContainerElement() {
  const fragment = beforeEachContainerTemplate.content.cloneNode(true);
  const containerEl = fragment.querySelector('.before-each-container');
  const listEl = containerEl.querySelector('.before-each-list');
  const addActionBtn = containerEl.querySelector('.btn-add-action-block');

  beforeEachListEl = listEl;

  for (const group of scenario.beforeEach) {
    listEl.appendChild(createBlockElement(group));
  }
  renumberGroups(scenario.beforeEach);

  addActionBtn.addEventListener('click', () => {
    const group = createExtraBeforeEachGroup();
    scenario.beforeEach.push(group);
    listEl.appendChild(createBlockElement(group));
    renumberGroups(scenario.beforeEach);
    updateJsonPreview();
  });

  return containerEl;
}

/* ==========================================================================
   MODE OPERATIONS ("+ Test" / "+ Tests" / "+ Add test")
   ========================================================================== */

function updateModeButtonsVisibility() {
  modeTestsBtn.hidden = scenario.mode === 'tests';
  growTestBtn.hidden = scenario.mode !== 'tests';
}

function addStandaloneTest({ focus = false } = {}) {
  scenario.mode = 'test';
  const test = createTestEntry({ removable: true });
  scenario.tests.push(test);

  const el = createTestElement(test);
  sharedStepsListEl.appendChild(el);

  updateModeButtonsVisibility();
  updateJsonPreview();

  if (focus) {
    testsById.get(test.id).titleInput.focus();
  }

  return test;
}

function createTestsScaffold() {
  scenario.mode = 'tests';

  scenario.beforeEach = [createFixedBeforeEachGroup()];
  sharedStepsListEl.appendChild(createBeforeEachContainerElement());

  for (let i = 0; i < 2; i += 1) {
    const test = createTestEntry({ removable: false });
    scenario.tests.push(test);
    sharedStepsListEl.appendChild(createTestElement(test));
  }

  updateModeButtonsVisibility();
  updateJsonPreview();
}

function growTestsScaffold() {
  const test = createTestEntry({ removable: true });
  scenario.tests.push(test);
  sharedStepsListEl.appendChild(createTestElement(test));
  updateJsonPreview();
}

// Wipes the beforeEach/tests/mode back to the initial empty state, without
// touching the scenario name/description. Used both by "Clear all" and
// when confirming a Test <-> Tests mode switch.
function resetDescribeOnly() {
  scenario.beforeEach = null;
  scenario.tests = [];
  scenario.mode = null;
  beforeEachListEl = null;
  sharedStepsListEl.innerHTML = '';
  rowsById.clear();
  testsById.clear();
  blocksById.clear();
}

let pendingModeSwitch = null;

function requestModeSwitch(targetMode, message) {
  pendingModeSwitch = targetMode;
  modeSwitchMessageEl.textContent = message;
  modeSwitchConfirmDialog.showModal();
}

/* ==========================================================================
   RESET ("Clear all")
   ========================================================================== */

function clearAll() {
  scenario.scenarioName = '';
  scenarioNameInput.value = '';

  scenario.scenarioDescription = '';
  scenarioDescriptionInput.value = '';

  resetDescribeOnly();
  updateModeButtonsVisibility();
  updateJsonPreview();
}

/* ==========================================================================
   EXPORT (deliberately NOT strict JSON)
   No `id`/`kind` anywhere — those are builder-only tracking fields.

   This is hand-built text, not JSON.stringify(someObject) — a real JS
   object can't hold the same key twice (the later one just silently wins
   before stringify ever runs), and the wanted shape needs exactly that:
   the "step" key repeated once per group (Action/Assertion block) inside
   a test, and the "test" key repeated once per test at the describe
   level, each occurrence carrying its own content. That's intentionally
   not valid JSON — it reads flatter and more code-like for an agent to
   scan, at the cost of not being machine-parseable via JSON.parse. There
   is no "Download JSON" button as a result; only "Copy to clipboard".

   Every leaf action/assertion carries its own `title` (copied from the
   group it's in) — the group is what supplies that shared title.
   ========================================================================== */

// Safely renders one scalar value (string or null) as it should appear in
// the output text — strings get JSON-correct quoting/escaping, null stays
// the bare literal `null`.
function serializeScalar(value) {
  return value === null ? 'null' : JSON.stringify(value);
}

function buildExportText() {
  const lines = [];
  const emit = (level, text) => lines.push('  '.repeat(level) + text);

  const emitLeaf = (leaf, level, isLast) => {
    emit(level, '{');
    emit(level + 1, `"action": ${serializeScalar(leaf.action)},`);
    emit(level + 1, `"target": ${serializeScalar(leaf.target)},`);
    emit(level + 1, `"selection": ${serializeScalar(leaf.selection)},`);
    emit(level + 1, `"value": ${serializeScalar(leaf.value)}`);
    emit(level, isLast ? '}' : '},');
  };

  // One "title" pairs with exactly one "step" array — the group as a
  // whole, not each leaf action inside it.
  const emitGroup = (group, level, isLast) => {
    emit(level, `"title": ${serializeScalar(group.title)},`);
    emit(level, '"step": [');
    group.actions.forEach((leaf, i) => {
      emitLeaf(leaf, level + 1, i === group.actions.length - 1);
    });
    emit(level, isLast ? ']' : '],');
  };

  const emitTest = (test, level, isLast) => {
    emit(level, '"test": {');
    emit(level + 1, `"title": ${serializeScalar(test.title)},`);
    test.steps.forEach((group, i) => {
      emitGroup(group, level + 1, i === test.steps.length - 1);
    });
    emit(level, isLast ? '}' : '},');
  };

  emit(0, '{');
  emit(1, `"scenarioName": ${serializeScalar(scenario.scenarioName)},`);
  emit(1, `"scenarioDescription": ${serializeScalar(scenario.scenarioDescription)},`);
  emit(1, '"describe": {');
  emit(2, `"title": ${serializeScalar(scenario.scenarioName)},`);

  if (scenario.beforeEach && scenario.beforeEach.length > 0) {
    emit(2, '"beforeEach": {');
    scenario.beforeEach.forEach((group, i) => {
      emitGroup(group, 3, i === scenario.beforeEach.length - 1);
    });
    emit(2, '},');
  } else {
    emit(2, '"beforeEach": null,');
  }

  if (scenario.tests.length === 0) {
    emit(2, '"test": null');
  } else {
    scenario.tests.forEach((test, i) => {
      emitTest(test, 2, i === scenario.tests.length - 1);
    });
  }

  emit(1, '}');
  emit(0, '}');

  return lines.join('\n');
}

async function copyJsonToClipboard() {
  const text = buildExportText();
  try {
    await navigator.clipboard.writeText(text);
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

modeTestBtn.addEventListener('click', () => {
  if (scenario.mode === 'tests') {
    requestModeSwitch('test', 'Switching to Test will clear your current Tests setup. Continue?');
    return;
  }
  addStandaloneTest({ focus: true });
});

modeTestsBtn.addEventListener('click', () => {
  if (scenario.mode === 'test') {
    requestModeSwitch('tests', 'Switching to Tests will clear your current Test setup. Continue?');
    return;
  }
  if (scenario.mode === null) {
    createTestsScaffold();
  }
});

growTestBtn.addEventListener('click', () => growTestsScaffold());

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

modeSwitchCancelBtn.addEventListener('click', () => {
  pendingModeSwitch = null;
  modeSwitchConfirmDialog.close();
});

modeSwitchConfirmBtn.addEventListener('click', () => {
  const target = pendingModeSwitch;
  pendingModeSwitch = null;
  modeSwitchConfirmDialog.close();

  resetDescribeOnly();
  if (target === 'test') {
    addStandaloneTest({ focus: true });
  } else if (target === 'tests') {
    createTestsScaffold();
  }
});

/* ==========================================================================
   INIT
   ========================================================================== */

function init() {
  updateModeButtonsVisibility();
  updateJsonPreview();
}

init();
