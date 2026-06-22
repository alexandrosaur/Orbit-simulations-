/**
 * main.js — Initializes the main catalog page
 * 
 * Loads simulation metadata from simulations.json,
 * renders cards, and handles search interactions.
 */

const SIMULATIONS_PATH = 'simulations.json';

async function loadSimulations() {
  try {
    const res = await fetch(SIMULATIONS_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.simulations || [];
  } catch (err) {
    console.error('Failed to load simulations:', err);
    return [];
  }
}

function renderCards(sims) {
  const grid = document.getElementById('simGrid');
  if (!grid) return;

  if (sims.length === 0) {
    grid.innerHTML = `<div class="sim-card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
      <p>No simulations match your search.</p>
    </div>`;
    return;
  }

  grid.innerHTML = sims.map(sim => {
    const emojiMap = { 'three-body': '⭐', 'three-body-ueff': '🌌', 'kepler': '🌍' };
    const emoji = emojiMap[sim.id] || '🚀';
    return `
      <div class="sim-card">
        <div class="sim-thumb">${emoji}</div>
        <div class="sim-body">
          <h3 class="sim-title">${escapeHtml(sim.title)}</h3>
          <p class="sim-desc">${escapeHtml(sim.description || '')}</p>
          <div class="sim-meta">
            <a href="${escapeHtml(sim.path || '#')}info.html" class="launch-btn">Launch</a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function filterSimulations(sims, query) {
  return sims.filter(sim => {
    const q = query.toLowerCase().trim();
    return !q ||
      sim.title.toLowerCase().includes(q) ||
      (sim.description || '').toLowerCase().includes(q);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const sims = await loadSimulations();
  const searchInput = document.getElementById('search');
  renderCards(sims);
  const update = () => {
    const query = searchInput ? searchInput.value : '';
    renderCards(filterSimulations(sims, query));
  };
  if (searchInput) searchInput.addEventListener('input', update);
});