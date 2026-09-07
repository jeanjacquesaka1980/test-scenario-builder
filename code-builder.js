// Test Code Builder — fully decoupled from the Test Scenario Builder
// (script.js). Own data model, no shared state. Wrapped in an IIFE so
// nothing here can collide with script.js.
//
// Architecture (corrected from the original v1 draft, which wrongly
// generated TypeScript in-browser):
//   - This file (the Builder) is pure authoring UI. It only assembles
//     blocks and exports a .yaml file (copy or download). It has no
//     filesystem access and does NOT generate TypeScript.
//   - A separate Node CLI (generator/generate.js) is the actual
//     Generator: it runs inside the target project, reads that YAML file,
//     validates paths, and writes real files with `fs`. It does not run
//     in the browser. See that file for the naming-convention rule,
//     path-safety checks, etc. — none of that logic belongs here.
//
// Block types built so far: file, data, spec.
//
// Shape:
//   block = { id, type: 'file', name, path, content }
//   block = { id, type: 'data', name, path, variables: [...] }
//   variable = { id, kind: 'const', name, type, value, importPath }
//   block = { id, type: 'spec', name, path, title, use, beforeEachEnabled,
//             beforeEachSteps: [...], tests: [...] }
//   test  = { id, title, steps: [...] }
//   step  = { id, title }
//
// A spec block is a fixed nesting, not a flat list: one describe (title)
// at the top; `use` and `beforeEach` are single on/off toggles under it
// (never repeatable, never configurable beyond on/off); beforeEach holds
// one-or-more steps when on; one-or-more tests live under describe, each
// with its own one-or-more steps. A step carries only a title — no
// action/target/locator, that's the Test Scenario Builder's job.
(function () {
  const cbState = {
    blocks: [],
  };

  let cbBlockIdCounter = 0;
  function cbNextBlockId() {
    cbBlockIdCounter += 1;
    return `cb-block-${cbBlockIdCounter}`;
  }

  function createFileBlock() {
    return { id: cbNextBlockId(), type: 'file', name: '', path: '', content: '' };
  }

  function createDataBlock() {
    return { id: cbNextBlockId(), type: 'data', name: '', path: '', variables: [] };
  }

  function createVariable() {
    return { id: cbNextBlockId(), kind: 'const', name: '', type: '', value: '', importPath: '' };
  }

  function createSpecBlock() {
    return {
      id: cbNextBlockId(),
      type: 'spec',
      name: '',
      path: '',
      title: '',
      use: false,
      beforeEachEnabled: false,
      beforeEachSteps: [],
      tests: [],
    };
  }

  function createSpecTest() {
    return { id: cbNextBlockId(), title: '', steps: [] };
  }

  function createSpecStep() {
    return { id: cbNextBlockId(), title: '' };
  }

  const cbBlocksById = new Map(); // block id -> { el }

  const cbBlocksListEl = document.getElementById('cb-blocks-list');
  const cbAddFileBtn = document.getElementById('cb-add-file-btn');
  const cbAddDataBtn = document.getElementById('cb-add-data-btn');
  const cbAddSpecBtn = document.getElementById('cb-add-spec-btn');
  const cbFileBlockTemplate = document.getElementById('cb-file-block-template');
  const cbDataBlockTemplate = document.getElementById('cb-data-block-template');
  const cbVariableRowTemplate = document.getElementById('cb-variable-row-template');
  const cbSpecBlockTemplate = document.getElementById('cb-spec-block-template');
  const cbSpecTestTemplate = document.getElementById('cb-spec-test-template');
  const cbSpecStepTemplate = document.getElementById('cb-spec-step-template');
  const cbPreviewEl = document.getElementById('cb-preview');
  const cbCopyBtn = document.getElementById('cb-copy-btn');
  const cbDownloadBtn = document.getElementById('cb-download-btn');
  const cbCopyFeedbackEl = document.getElementById('cb-copy-feedback');

  /* ==========================================================================
     RENDERING
     ========================================================================== */

  function createFileBlockElement(block) {
    const fragment = cbFileBlockTemplate.content.cloneNode(true);
    const blockEl = fragment.querySelector('.cb-file-block');
    blockEl.dataset.cbBlockId = block.id;

    const nameInput = blockEl.querySelector('.cb-file-name');
    const pathInput = blockEl.querySelector('.cb-file-path');
    const contentInput = blockEl.querySelector('.cb-file-content');
    const removeBtn = blockEl.querySelector('.btn-remove-block');

    nameInput.value = block.name;
    pathInput.value = block.path;
    contentInput.value = block.content;

    nameInput.addEventListener('input', () => {
      block.name = nameInput.value;
      renderPreview();
    });
    pathInput.addEventListener('input', () => {
      block.path = pathInput.value;
      renderPreview();
    });
    contentInput.addEventListener('input', () => {
      block.content = contentInput.value;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => removeBlock(block.id));

    cbBlocksById.set(block.id, { el: blockEl });
    return blockEl;
  }

  function removeBlock(blockId) {
    const index = cbState.blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return;
    cbState.blocks.splice(index, 1);

    const refs = cbBlocksById.get(blockId);
    if (refs) {
      refs.el.remove();
      cbBlocksById.delete(blockId);
    }

    renderPreview();
  }

  function addFileBlock() {
    const block = createFileBlock();
    cbState.blocks.push(block);
    cbBlocksListEl.appendChild(createFileBlockElement(block));
    renderPreview();
  }

  function createVariableRowElement(block, variable) {
    const fragment = cbVariableRowTemplate.content.cloneNode(true);
    const rowEl = fragment.querySelector('.cb-variable-row');
    rowEl.dataset.cbVariableId = variable.id;

    const kindSelect = rowEl.querySelector('.cb-variable-kind');
    const nameInput = rowEl.querySelector('.cb-variable-name');
    const typeInput = rowEl.querySelector('.cb-variable-type');
    const valueInput = rowEl.querySelector('.cb-variable-value');
    const importPathInput = rowEl.querySelector('.cb-variable-import-path');
    const removeBtn = rowEl.querySelector('.btn-remove-variable');

    kindSelect.value = variable.kind;
    nameInput.value = variable.name;
    typeInput.value = variable.type;
    valueInput.value = variable.value;
    importPathInput.value = variable.importPath;

    kindSelect.addEventListener('change', () => {
      variable.kind = kindSelect.value;
      renderPreview();
    });
    nameInput.addEventListener('input', () => {
      variable.name = nameInput.value;
      renderPreview();
    });
    typeInput.addEventListener('input', () => {
      variable.type = typeInput.value;
      renderPreview();
    });
    valueInput.addEventListener('input', () => {
      variable.value = valueInput.value;
      renderPreview();
    });
    importPathInput.addEventListener('input', () => {
      variable.importPath = importPathInput.value;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => {
      const index = block.variables.findIndex((v) => v.id === variable.id);
      if (index !== -1) block.variables.splice(index, 1);
      rowEl.remove();
      renderPreview();
    });

    return rowEl;
  }

  function createDataBlockElement(block) {
    const fragment = cbDataBlockTemplate.content.cloneNode(true);
    const blockEl = fragment.querySelector('.cb-data-block');
    blockEl.dataset.cbBlockId = block.id;

    const nameInput = blockEl.querySelector('.cb-file-name');
    const pathInput = blockEl.querySelector('.cb-file-path');
    const removeBtn = blockEl.querySelector('.btn-remove-block');
    const variablesListEl = blockEl.querySelector('.cb-variables-list');
    const addVariableBtn = blockEl.querySelector('.cb-add-variable-btn');

    nameInput.value = block.name;
    pathInput.value = block.path;

    nameInput.addEventListener('input', () => {
      block.name = nameInput.value;
      renderPreview();
    });
    pathInput.addEventListener('input', () => {
      block.path = pathInput.value;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => removeBlock(block.id));

    for (const variable of block.variables) {
      variablesListEl.appendChild(createVariableRowElement(block, variable));
    }

    addVariableBtn.addEventListener('click', () => {
      const variable = createVariable();
      block.variables.push(variable);
      variablesListEl.appendChild(createVariableRowElement(block, variable));
      renderPreview();
    });

    cbBlocksById.set(block.id, { el: blockEl });
    return blockEl;
  }

  function addDataBlock() {
    const block = createDataBlock();
    cbState.blocks.push(block);
    cbBlocksListEl.appendChild(createDataBlockElement(block));
    renderPreview();
  }

  // Reused for a step under beforeEach and a step under any test — the
  // caller passes whichever `steps` array this one lives in, since a step
  // only needs to know how to remove itself from that array.
  function createSpecStepElement(steps, step) {
    const fragment = cbSpecStepTemplate.content.cloneNode(true);
    const stepEl = fragment.querySelector('.cb-spec-step');
    stepEl.dataset.cbSpecStepId = step.id;

    const titleInput = stepEl.querySelector('.cb-spec-step-title');
    const removeBtn = stepEl.querySelector('.btn-remove-spec-step');

    titleInput.value = step.title;
    titleInput.addEventListener('input', () => {
      step.title = titleInput.value;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => {
      const index = steps.findIndex((s) => s.id === step.id);
      if (index !== -1) steps.splice(index, 1);
      stepEl.remove();
      renderPreview();
    });

    return stepEl;
  }

  // "+ Add step" here is scoped to this one test's own steps array, not
  // global — mirrors how a test's own "+ Action"/"+ Assertion" work in
  // the Scenario Builder tab.
  function createSpecTestElement(specBlock, testEntry) {
    const fragment = cbSpecTestTemplate.content.cloneNode(true);
    const testEl = fragment.querySelector('.cb-spec-test');
    testEl.dataset.cbSpecTestId = testEntry.id;

    const titleInput = testEl.querySelector('.cb-spec-test-title');
    const removeBtn = testEl.querySelector('.btn-remove-spec-test');
    const stepsListEl = testEl.querySelector('.cb-spec-steps-list');
    const addStepBtn = testEl.querySelector('.cb-spec-add-step-btn');

    titleInput.value = testEntry.title;
    titleInput.addEventListener('input', () => {
      testEntry.title = titleInput.value;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => {
      const index = specBlock.tests.findIndex((t) => t.id === testEntry.id);
      if (index !== -1) specBlock.tests.splice(index, 1);
      testEl.remove();
      renderPreview();
    });

    for (const step of testEntry.steps) {
      stepsListEl.appendChild(createSpecStepElement(testEntry.steps, step));
    }

    addStepBtn.addEventListener('click', () => {
      const step = createSpecStep();
      testEntry.steps.push(step);
      stepsListEl.appendChild(createSpecStepElement(testEntry.steps, step));
      renderPreview();
    });

    return testEl;
  }

  function createSpecBlockElement(block) {
    const fragment = cbSpecBlockTemplate.content.cloneNode(true);
    const blockEl = fragment.querySelector('.cb-spec-block');
    blockEl.dataset.cbBlockId = block.id;

    const nameInput = blockEl.querySelector('.cb-file-name');
    const pathInput = blockEl.querySelector('.cb-file-path');
    const removeBtn = blockEl.querySelector('.btn-remove-block');
    const describeTitleInput = blockEl.querySelector('.cb-spec-describe-title');
    const useToggle = blockEl.querySelector('.cb-spec-use-toggle');
    const beforeEachToggle = blockEl.querySelector('.cb-spec-before-each-toggle');
    const beforeEachBody = blockEl.querySelector('.cb-spec-before-each-body');
    const beforeEachStepsListEl = blockEl.querySelector('.cb-spec-before-each-steps-list');
    const addBeforeEachStepBtn = blockEl.querySelector('.cb-spec-add-before-each-step-btn');
    const testsListEl = blockEl.querySelector('.cb-spec-tests-list');
    const addTestBtn = blockEl.querySelector('.cb-spec-add-test-btn');

    nameInput.value = block.name;
    pathInput.value = block.path;
    describeTitleInput.value = block.title;
    useToggle.checked = block.use;
    beforeEachToggle.checked = block.beforeEachEnabled;
    beforeEachBody.hidden = !block.beforeEachEnabled;

    nameInput.addEventListener('input', () => {
      block.name = nameInput.value;
      renderPreview();
    });
    pathInput.addEventListener('input', () => {
      block.path = pathInput.value;
      renderPreview();
    });
    describeTitleInput.addEventListener('input', () => {
      block.title = describeTitleInput.value;
      renderPreview();
    });
    useToggle.addEventListener('change', () => {
      block.use = useToggle.checked;
      renderPreview();
    });
    beforeEachToggle.addEventListener('change', () => {
      block.beforeEachEnabled = beforeEachToggle.checked;
      beforeEachBody.hidden = !block.beforeEachEnabled;
      renderPreview();
    });

    removeBtn.addEventListener('click', () => removeBlock(block.id));

    for (const step of block.beforeEachSteps) {
      beforeEachStepsListEl.appendChild(createSpecStepElement(block.beforeEachSteps, step));
    }
    addBeforeEachStepBtn.addEventListener('click', () => {
      const step = createSpecStep();
      block.beforeEachSteps.push(step);
      beforeEachStepsListEl.appendChild(createSpecStepElement(block.beforeEachSteps, step));
      renderPreview();
    });

    for (const testEntry of block.tests) {
      testsListEl.appendChild(createSpecTestElement(block, testEntry));
    }
    addTestBtn.addEventListener('click', () => {
      const testEntry = createSpecTest();
      block.tests.push(testEntry);
      testsListEl.appendChild(createSpecTestElement(block, testEntry));
      renderPreview();
    });

    cbBlocksById.set(block.id, { el: blockEl });
    return blockEl;
  }

  function addSpecBlock() {
    const block = createSpecBlock();
    cbState.blocks.push(block);
    cbBlocksListEl.appendChild(createSpecBlockElement(block));
    renderPreview();
  }

  /* ==========================================================================
     YAML SERIALIZATION
     Hand-written rather than a library, since the shape is small and
     fully under our control — but it still has to produce YAML a real
     parser (js-yaml, in the generator) can read back correctly, so plain
     scalars are quoted whenever they're not obviously YAML-safe bare.
     ========================================================================== */

  function isYamlSafeBare(str) {
    if (str === '') return false;
    if (/^\s|\s$/.test(str)) return false;
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(str)) return false;
    if (/: |:$/.test(str)) return false;
    if (/^(null|Null|NULL|~|true|True|TRUE|false|False|FALSE)$/.test(str)) return false;
    if (/^[+-]?(\.\d|\d)/.test(str) && !Number.isNaN(Number(str))) return false;
    return true;
  }

  // Renders one scalar value as a single-line YAML flow scalar (used for
  // simple fields like name/path — never for multi-line content, which
  // uses a block literal instead, see emitFileBlock).
  function yamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    const str = String(value);
    if (isYamlSafeBare(str)) return str;
    return JSON.stringify(str); // a JSON string literal is also valid YAML
  }

  function yamlBlockLiteral(text, indent) {
    const lines = text.split('\n').map((line) => `${indent}  ${line}`);
    return [`${indent}content: |`, ...lines].join('\n');
  }

  function serializeBlocksToYaml(blocks) {
    if (blocks.length === 0) return 'blocks: []\n';

    const lines = ['blocks:'];
    for (const block of blocks) {
      if (block.type === 'data') {
        lines.push('  - type: data');
        lines.push(`    name: ${yamlScalar(block.name)}`);
        lines.push(`    path: ${yamlScalar(block.path)}`);
        if (block.variables.length === 0) {
          lines.push('    variables: []');
        } else {
          lines.push('    variables:');
          for (const variable of block.variables) {
            lines.push(`      - kind: ${yamlScalar(variable.kind)}`);
            lines.push(`        name: ${yamlScalar(variable.name)}`);
            lines.push(`        type: ${yamlScalar(variable.type)}`);
            lines.push(`        value: ${yamlScalar(variable.value)}`);
            const importPath = variable.importPath.trim();
            lines.push(`        importPath: ${importPath === '' ? 'null' : yamlScalar(importPath)}`);
          }
        }
        continue;
      }

      if (block.type === 'spec') {
        lines.push('  - type: spec');
        lines.push(`    name: ${yamlScalar(block.name)}`);
        lines.push(`    path: ${yamlScalar(block.path)}`);
        lines.push(`    title: ${yamlScalar(block.title)}`);
        lines.push(`    use: ${block.use}`);

        lines.push('    beforeEach:');
        lines.push(`      enabled: ${block.beforeEachEnabled}`);
        if (block.beforeEachSteps.length === 0) {
          lines.push('      steps: []');
        } else {
          lines.push('      steps:');
          for (const step of block.beforeEachSteps) {
            lines.push(`        - title: ${yamlScalar(step.title)}`);
          }
        }

        if (block.tests.length === 0) {
          lines.push('    tests: []');
        } else {
          lines.push('    tests:');
          for (const testEntry of block.tests) {
            lines.push(`      - title: ${yamlScalar(testEntry.title)}`);
            if (testEntry.steps.length === 0) {
              lines.push('        steps: []');
            } else {
              lines.push('        steps:');
              for (const step of testEntry.steps) {
                lines.push(`          - title: ${yamlScalar(step.title)}`);
              }
            }
          }
        }
        continue;
      }

      lines.push('  - type: file');
      lines.push(`    name: ${yamlScalar(block.name)}`);
      lines.push(`    path: ${yamlScalar(block.path)}`);
      if (block.content.trim() !== '') {
        lines.push(yamlBlockLiteral(block.content, '    '));
      } else {
        lines.push('    content: null');
      }
    }
    return `${lines.join('\n')}\n`;
  }

  function renderPreview() {
    cbPreviewEl.textContent = serializeBlocksToYaml(cbState.blocks);
  }

  /* ==========================================================================
     EXPORT — copy or download the YAML itself. This tool never writes
     project files; that's the separate Node generator's job.
     ========================================================================== */

  // With exactly one block, name the download after that block's own
  // name (swapping ".ts" for ".yaml") so it's obvious which file it's
  // for. With zero or several blocks there's no one name to use, so it
  // falls back to a generic name.
  function deriveYamlFilename() {
    if (cbState.blocks.length === 1) {
      const name = cbState.blocks[0].name.trim();
      if (name !== '') {
        const base = name.endsWith('.ts') ? name.slice(0, -3) : name;
        return `${base}.yaml`;
      }
    }
    return 'test-code-builder.yaml';
  }

  function downloadYaml() {
    const blob = new Blob([cbPreviewEl.textContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = deriveYamlFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let cbCopyFeedbackTimer = null;
  function showCopyFeedback(message) {
    cbCopyFeedbackEl.textContent = message;
    clearTimeout(cbCopyFeedbackTimer);
    cbCopyFeedbackTimer = setTimeout(() => {
      cbCopyFeedbackEl.textContent = '';
    }, 1800);
  }

  async function copyYamlToClipboard() {
    try {
      await navigator.clipboard.writeText(cbPreviewEl.textContent);
      showCopyFeedback('Copied!');
    } catch (err) {
      showCopyFeedback('Copy failed');
    }
  }

  /* ==========================================================================
     EVENTS + INIT
     ========================================================================== */

  cbAddFileBtn.addEventListener('click', () => addFileBlock());
  cbAddDataBtn.addEventListener('click', () => addDataBlock());
  cbAddSpecBtn.addEventListener('click', () => addSpecBlock());
  cbCopyBtn.addEventListener('click', copyYamlToClipboard);
  cbDownloadBtn.addEventListener('click', downloadYaml);

  renderPreview();
})();
