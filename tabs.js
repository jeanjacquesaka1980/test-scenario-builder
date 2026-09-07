// Shell-level tab switching only — knows nothing about either tool's data
// model. Deliberately its own file so neither script.js (Test Scenario
// Builder) nor code-builder.js (Test Code Builder) has to own this.
(function () {
  const tabs = [
    { btn: document.getElementById('tab-btn-scenario'), panel: document.getElementById('tab-panel-scenario') },
    { btn: document.getElementById('tab-btn-code'), panel: document.getElementById('tab-panel-code') },
  ];

  // "Clear all" in the header belongs to the Scenario Builder tool only —
  // hide it on any other tab so it can't be clicked against the wrong tool.
  const clearAllBtn = document.getElementById('clear-all-btn');

  function activate(activeIndex) {
    tabs.forEach(({ btn, panel }, index) => {
      const isActive = index === activeIndex;
      btn.classList.toggle('app-tab-btn-active', isActive);
      panel.hidden = !isActive;
    });
    clearAllBtn.hidden = activeIndex !== 0;
  }

  tabs.forEach(({ btn }, index) => {
    btn.addEventListener('click', () => activate(index));
  });
})();
