/* ==========================================================================
   EZ-Print Application Entry Point
   ========================================================================== */
(function (global) {
  'use strict';

  function bootstrap() {
    const { Store, PreviewRenderer, UIController } = global.EZPrint;

    const store = new Store();
    const preview = new PreviewRenderer(
      {
        previewScroll: document.getElementById('previewScroll'),
        emptyState: document.getElementById('emptyState'),
        sheetsContainer: document.getElementById('sheetsContainer'),
        dynamicPageStyle: document.getElementById('dynamic-page-style'),
        zoomFitBtn: document.getElementById('zoomFitBtn')
      },
      store
    );

    const ui = new UIController(store, preview);

    // Expose cleanly for debugging if needed
    global.EZPrint.instance = { store, preview, ui };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
