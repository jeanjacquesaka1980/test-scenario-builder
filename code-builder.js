// Test Code Builder — fully decoupled from the Test Scenario Builder
// (script.js). Own data model, own generator, no shared state, no AI in
// this generation path: YAML-shaped blocks in, deterministic TypeScript
// out. Wrapped in an IIFE so nothing here can collide with script.js.
//
// v1 build order (see the prompt this was built from) — build and verify
// one numbered feature at a time:
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

  const cbBlocksById = new Map(); // block id -> { el, errorEl }

  const cbBlocksListEl = document.getElementById('cb-blocks-list');
  const cbAddFileBtn = document.getElementById('cb-add-file-btn');
  const cbFileBlockTemplate = document.getElementById('cb-file-block-template');
  const cbPreviewEl = document.getElementById('cb-preview');
  const cbCopyBtn = document.getElementById('cb-copy-btn');
  const cbCopyFeedbackEl = document.getElementById('cb-copy-feedback');

  /* ==========================================================================
     NAMING CONVENTION (file blocks with no content)
     "no-data-shown.data.ts" -> base "no-data-shown", suffix "data" ->
     "export const noDataShownData = {};". Fixed rule, not configurable.
     A file name that doesn't have exactly <base>.<suffix>.ts is a hard
     error, not a silent fallback.
     ========================================================================== */

  function kebabToCamel(str) {
    return str
      .split('-')
      .filter((word) => word !== '')
      .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
      .join('');
  }

  function deriveConstName(fileName) {
    const parts = fileName.split('.');
    if (parts.length !== 3 || parts[2] !== 'ts') {
      throw new Error(
        `"${fileName}" must look like <base>.<suffix>.ts to derive an export name (got ${parts.length} dot-separated part${parts.length === 1 ? '' : 's'})`
      );
    }
    const [base, suffix] = parts;
    if (base === '' || suffix === '') {
      throw new Error(`"${fileName}" is missing its base name or suffix`);
    }
    const capitalizedSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
    return `${kebabToCamel(base)}${capitalizedSuffix}`;
  }

  // Throws on an invalid file name (see deriveConstName) — callers decide
  // how to surface that (inline error vs. alert).
  function generateFileBlockOutput(block) {
    const content = block.content.trim();
    if (content !== '') {
      return content.endsWith('\n') ? content : `${content}\n`;
    }
    const constName = deriveConstName(block.name);
    return `export const ${constName} = {};\n`;
  }

  function joinPath(path, name) {
    const trimmedPath = path.trim().replace(/\/+$/, '');
    return trimmedPath ? `${trimmedPath}/${name}` : name;
  }

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
    const downloadBtn = blockEl.querySelector('.cb-download-btn');
    const errorEl = blockEl.querySelector('.cb-block-error');

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
    downloadBtn.addEventListener('click', () => downloadFileBlock(block));

    cbBlocksById.set(block.id, { el: blockEl, errorEl });
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
     PREVIEW
     One section per block ("Output: a file per block"), each headed by
     its resolved path so it's clear which file it represents. A block
     with an invalid file name shows its error inline (in the block's own
     card) and in the preview, instead of guessing.
     ========================================================================== */

  function renderPreview() {
    const sections = cbState.blocks.map((block) => {
      const fullPath = joinPath(block.path, block.name) || '(unnamed file)';
      const header = `// ---- ${fullPath} ----`;
      const refs = cbBlocksById.get(block.id);

      let body;
      let errorMessage = null;
      try {
        body = generateFileBlockOutput(block);
      } catch (err) {
        errorMessage = err.message;
      }

      if (refs) {
        refs.errorEl.hidden = !errorMessage;
        refs.errorEl.textContent = errorMessage || '';
      }

      return errorMessage ? `${header}\n// ERROR: ${errorMessage}` : `${header}\n${body}`;
    });

    cbPreviewEl.textContent = sections.join('\n');
  }

  /* ==========================================================================
     EXPORT (copy to clipboard, and a per-file download since — unlike the
     Test Scenario Builder's pseudo-JSON — this output is real, parseable
     TypeScript with a real file name to save it under)
     ========================================================================== */

  function downloadFileBlock(block) {
    let body;
    try {
      body = generateFileBlockOutput(block);
    } catch (err) {
      window.alert(err.message);
      return;
    }

    const blob = new Blob([body], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = block.name || 'file.ts';
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

  async function copyPreviewToClipboard() {
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
  cbCopyBtn.addEventListener('click', copyPreviewToClipboard);

  renderPreview();
})();
