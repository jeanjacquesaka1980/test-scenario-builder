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
// v1 build order — build and verify one numbered feature at a time:
//   1. `file` block only                              <- this is where we are
//   2. `describe` block, empty body
//   3. `use` boolean toggle
//   4. `beforeEach` boolean toggle
//   5. `tests` array, actions rendered as raw comments
//
// Shape so far:
//   block = { id, type: 'file', name, path, content }
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

  const cbBlocksById = new Map(); // block id -> { el }

  const cbBlocksListEl = document.getElementById('cb-blocks-list');
  const cbAddFileBtn = document.getElementById('cb-add-file-btn');
  const cbFileBlockTemplate = document.getElementById('cb-file-block-template');
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
      lines.push(`  - type: file`);
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

  function downloadYaml() {
    const blob = new Blob([cbPreviewEl.textContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'test-code-builder.yaml';
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
  cbCopyBtn.addEventListener('click', copyYamlToClipboard);
  cbDownloadBtn.addEventListener('click', downloadYaml);

  renderPreview();
})();
