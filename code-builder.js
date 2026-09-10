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
// Block types: file, data. (There was a spec block here too, at one
// point — it moved to the Test Scenario Builder tab's own YAML export
// instead, since that's the tool that actually holds test/step content.
// generator/blocks/spec.js still turns that YAML into a .spec.ts; it just
// isn't authored from a block in this tab anymore.)
//
// Shape:
//   block = { id, type: 'file', name, path, content }
//   block = { id, type: 'data', name, path, variables: [...] }
//   variable = { id, kind: 'const', name, type, value, importPath }
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

  const cbBlocksById = new Map(); // block id -> { el }

  const cbBlocksListEl = document.getElementById('cb-blocks-list');
  const cbAddFileBtn = document.getElementById('cb-add-file-btn');
  const cbAddDataBtn = document.getElementById('cb-add-data-btn');
  const cbFileBlockTemplate = document.getElementById('cb-file-block-template');
  const cbDataBlockTemplate = document.getElementById('cb-data-block-template');
  const cbVariableRowTemplate = document.getElementById('cb-variable-row-template');
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
    const duplicateBtn = blockEl.querySelector('.btn-duplicate-block');
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

    duplicateBtn.addEventListener('click', () => duplicateBlock(block.id));
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

  function cloneVariable(variable) {
    return {
      id: cbNextBlockId(),
      kind: variable.kind,
      name: variable.name,
      type: variable.type,
      value: variable.value,
      importPath: variable.importPath,
    };
  }

  function cloneCbBlock(block) {
    if (block.type === 'data') {
      return {
        id: cbNextBlockId(),
        type: 'data',
        name: block.name,
        path: block.path,
        variables: block.variables.map(cloneVariable),
      };
    }
    return { id: cbNextBlockId(), type: 'file', name: block.name, path: block.path, content: block.content };
  }

  function createBlockElementByType(block) {
    return block.type === 'data' ? createDataBlockElement(block) : createFileBlockElement(block);
  }

  // Inserts a copy of the block right after it in cbState.blocks.
  function duplicateBlock(blockId) {
    const index = cbState.blocks.findIndex((b) => b.id === blockId);
    if (index === -1) return;

    const clone = cloneCbBlock(cbState.blocks[index]);
    cbState.blocks.splice(index + 1, 0, clone);

    const cloneEl = createBlockElementByType(clone);
    const originalEl = cbBlocksById.get(blockId).el;
    const nextSibling = originalEl.nextElementSibling;
    if (nextSibling) {
      cbBlocksListEl.insertBefore(cloneEl, nextSibling);
    } else {
      cbBlocksListEl.appendChild(cloneEl);
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
    const duplicateBtn = blockEl.querySelector('.btn-duplicate-block');
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

    duplicateBtn.addEventListener('click', () => duplicateBlock(block.id));
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
  cbCopyBtn.addEventListener('click', copyYamlToClipboard);
  cbDownloadBtn.addEventListener('click', downloadYaml);

  renderPreview();
})();
