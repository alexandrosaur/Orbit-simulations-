/**
 * shortcut-legend.js — Injects a collapsible on-screen keyboard shortcut legend
 *
 * Used by every simulation page to show available keyboard shortcuts.
 * Call once after DOM is ready with page-specific extra items.
 *
 * @example
 *   import { injectShortcutLegend } from '../../js/ui/shortcut-legend.js';
 *   injectShortcutLegend([
 *     'Right-click canvas — Add body',
 *     'Drag on 2D canvas — Reposition body',
 *     'Drag on 3D canvas — Orbit camera',
 *   ]);
 */

/**
 * Injects a <details> panel with keyboard shortcuts into the given container.
 * If containerId is omitted, defaults to 'shortcutLegend'.
 *
 * @param {string[]} [extraItems=[]] — Additional page-specific shortcut descriptions.
 * @param {string} [containerId='shortcutLegend'] — ID of the container element.
 */
export function injectShortcutLegend(extraItems = [], containerId = 'shortcutLegend') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const baseItems = [
    '<kbd>Space</kbd> — Play / Pause',
    '<kbd>R</kbd> — Reset simulation',
    '<kbd>S</kbd> — Step one frame',
    '<kbd>F</kbd> — Fit 2D view to screen',
  ];

  const allItems = [...baseItems, ...extraItems];

  const details = document.createElement('details');
  details.className = 'shortcut-legend';
  const summary = document.createElement('summary');
  summary.textContent = 'Keyboard Shortcuts';
  details.appendChild(summary);

  const ul = document.createElement('ul');
  for (const item of allItems) {
    const li = document.createElement('li');
    li.innerHTML = item;
    ul.appendChild(li);
  }
  details.appendChild(ul);
  container.appendChild(details);
}