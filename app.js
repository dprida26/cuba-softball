/* =====================================================
   CUBA SOFTBOL - Application Logic
   Data lives in Airtable, read/written through Netlify
   Functions (netlify/functions/*) so the Airtable token
   and admin password never reach the browser.
   ===================================================== */

// ---- Constants ----
const API_BASE = '/.netlify/functions';
const STAT_KEYS = ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB'];
const STAT_LABELS = ['AB', 'C', 'H', '2B', '3B', 'HR', 'CI', 'BB', 'SO', 'BR'];

// ---- State ----
let appData = { players: [], games: [] };
let isAdminMode = false;
let adminPassword = null; // kept in memory only, sent with each write request
let sortColumn = 'number';
let sortDirection = 'asc';
let editingGameId = null;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  renderRoster();
  renderStats();
  renderGames();
  updateHeroStats();
  setupNavigation();
  setupScrollAnimations();

  // Set today's date as default for game form
  const dateInput = document.getElementById('gameDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
});

// ---- API Helpers ----
async function apiGet(path) {
  const res = await fetch(`${API_BASE}/${path}`);
  const data = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error(data.error || 'Error al cargar datos');
  return data;
}

async function apiSend(path, method, body) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': adminPassword || ''
    },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

async function loadAllData() {
  try {
    const [players, games] = await Promise.all([apiGet('players'), apiGet('games')]);
    appData = { players, games };
  } catch (e) {
    appData = { players: [], games: [] };
    showToast('No se pudieron cargar los datos desde el servidor.', 'error');
  }
}

// ---- Roster Rendering ----
function renderRoster() {
  const grid = document.getElementById('rosterGrid');
  grid.innerHTML = '';

  appData.players.forEach((player) => {
    const card = document.createElement('div');
    card.className = 'player-card animate-in';

    const photoContent = player.photo
      ? `<img class="player-photo" src="${player.photo}" alt="${player.name}">`
      : `<div class="player-photo-placeholder"><i class="fas fa-user"></i></div>`;

    card.innerHTML = `
      <div class="jersey-header">
        <svg class="jersey-star" viewBox="0 0 24 24"><polygon points="12,2 14.9,9.2 22.5,9.5 16.5,14.3 18.6,21.7 12,17.3 5.4,21.7 7.5,14.3 1.5,9.5 9.1,9.2"/></svg>
        <div class="player-number">
          <span>#</span>${player.number}
        </div>
      </div>
      <div class="player-photo-container">
        ${photoContent}
        <div class="player-photo-overlay" onclick="triggerPhotoUpload('${player.id}')" title="${player.photo ? 'Cambiar foto' : 'Subir foto'}">
          <i class="fas fa-camera"></i>
        </div>
        <input type="file" class="player-photo-input" id="photoInput_${player.id}"
               accept="image/*" onchange="handlePhotoUpload('${player.id}', this)">
      </div>
      <div class="card-body">
        <div class="player-name">${player.name}</div>
        ${player.position ? `<div class="player-position">${player.position}</div>` : ''}
      </div>
      <div class="card-watermark">★</div>
    `;
    grid.appendChild(card);
  });
}

// ---- Photo Upload Functions ----
function triggerPhotoUpload(playerId) {
  if (!isAdminMode) return;
  const input = document.getElementById(`photoInput_${playerId}`);
  if (input) input.click();
}

function handlePhotoUpload(playerId, input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('Imagen muy grande. Máximo 5MB.', 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    // Resize before upload to keep Airtable storage and transfer light
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 400;
      let w = img.width;
      let h = img.height;

      if (w > h) {
        if (w > MAX_SIZE) { h = h * MAX_SIZE / w; w = MAX_SIZE; }
      } else {
        if (h > MAX_SIZE) { w = w * MAX_SIZE / h; h = MAX_SIZE; }
      }

      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];

      try {
        const result = await apiSend('upload-photo', 'POST', {
          playerId,
          base64,
          contentType: 'image/jpeg',
          filename: `player_${playerId}.jpg`
        });
        const player = findPlayer(playerId);
        if (player) player.photo = result.photo;
        renderRoster();
        showToast('Foto actualizada ✓', 'success');
      } catch (err) {
        showToast('No se pudo subir la foto: ' + err.message, 'error');
      } finally {
        input.value = '';
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function findPlayer(id) {
  return appData.players.find(p => p.id === id) || null;
}

// ---- Statistics Rendering ----
function renderStats() {
  const tbody = document.getElementById('statsBody');
  const tfoot = document.getElementById('statsFoot');
  tbody.innerHTML = '';
  tfoot.innerHTML = '';

  // Calculate stats for each player
  const playerStats = appData.players.map(player => {
    const stats = calculatePlayerStats(player.id);
    return { ...player, computed: stats };
  });

  // Sort
  playerStats.sort((a, b) => {
    if (sortColumn === 'name') {
      return sortDirection === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    }
    if (sortColumn === 'number') {
      const numA = isNaN(parseInt(a.number, 10)) ? -1 : parseInt(a.number, 10);
      const numB = isNaN(parseInt(b.number, 10)) ? -1 : parseInt(b.number, 10);
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    }
    const valA = a.computed[sortColumn] || 0;
    const valB = b.computed[sortColumn] || 0;
    return sortDirection === 'asc' ? valA - valB : valB - valA;
  });

  // Find best stats for highlighting
  const bests = {};
  STAT_KEYS.concat(['AVG', 'OBP', 'SLG']).forEach(key => {
    const values = playerStats.map(p => p.computed[key] || 0).filter(v => v > 0);
    bests[key] = values.length > 0 ? Math.max(...values) : 0;
  });

  // Totals
  const totals = { GP: 0 };
  STAT_KEYS.forEach(k => totals[k] = 0);

  playerStats.forEach(player => {
    const s = player.computed;
    const row = document.createElement('tr');

    const highlightClass = (key, val) => {
      return val > 0 && val === bests[key] ? ' stat-highlight' : '';
    };

    row.innerHTML = `
      <td class="player-num-cell">${player.number}</td>
      <td>${player.name}</td>
      <td>${s.GP}</td>
      <td>${s.AB}</td>
      <td>${s.R}</td>
      <td class="${highlightClass('H', s.H)}">${s.H}</td>
      <td class="${highlightClass('2B', s['2B'])}">${s['2B']}</td>
      <td class="${highlightClass('3B', s['3B'])}">${s['3B']}</td>
      <td class="${highlightClass('HR', s.HR)}">${s.HR}</td>
      <td class="${highlightClass('RBI', s.RBI)}">${s.RBI}</td>
      <td>${s.BB}</td>
      <td>${s.SO}</td>
      <td>${s.SB}</td>
      <td class="${highlightClass('AVG', s.AVG)}">${formatAvg(s.AVG)}</td>
      <td class="${highlightClass('OBP', s.OBP)}">${formatAvg(s.OBP)}</td>
      <td class="${highlightClass('SLG', s.SLG)}">${formatAvg(s.SLG)}</td>
    `;
    tbody.appendChild(row);

    // Accumulate totals
    totals.GP = Math.max(totals.GP, s.GP);
    STAT_KEYS.forEach(k => totals[k] += s[k]);
  });

  // Calculate team averages
  const teamAVG = totals.AB > 0 ? totals.H / totals.AB : 0;
  const teamOBP = (totals.AB + totals.BB) > 0 ? (totals.H + totals.BB) / (totals.AB + totals.BB) : 0;
  const teamTB = totals.H + totals['2B'] + 2 * totals['3B'] + 3 * totals.HR;
  const teamSLG = totals.AB > 0 ? teamTB / totals.AB : 0;

  const footRow = document.createElement('tr');
  footRow.innerHTML = `
    <td></td>
    <td>EQUIPO</td>
    <td>${appData.games.length}</td>
    <td>${totals.AB}</td>
    <td>${totals.R}</td>
    <td>${totals.H}</td>
    <td>${totals['2B']}</td>
    <td>${totals['3B']}</td>
    <td>${totals.HR}</td>
    <td>${totals.RBI}</td>
    <td>${totals.BB}</td>
    <td>${totals.SO}</td>
    <td>${totals.SB}</td>
    <td>${formatAvg(teamAVG)}</td>
    <td>${formatAvg(teamOBP)}</td>
    <td>${formatAvg(teamSLG)}</td>
  `;
  tfoot.appendChild(footRow);

  // Setup sort headers
  setupSortHeaders();
}

function calculatePlayerStats(playerId) {
  const stats = { GP: 0 };
  STAT_KEYS.forEach(k => stats[k] = 0);

  appData.games.forEach(game => {
    if (game.playerStats && game.playerStats[playerId]) {
      const gs = game.playerStats[playerId];
      // Count as game played if any stat > 0
      const played = STAT_KEYS.some(k => (gs[k] || 0) > 0);
      if (played) stats.GP++;
      STAT_KEYS.forEach(k => stats[k] += (gs[k] || 0));
    }
  });

  // Computed stats
  stats.AVG = stats.AB > 0 ? stats.H / stats.AB : 0;
  stats.OBP = (stats.AB + stats.BB) > 0 ? (stats.H + stats.BB) / (stats.AB + stats.BB) : 0;
  const TB = stats.H + stats['2B'] + 2 * stats['3B'] + 3 * stats.HR;
  stats.SLG = stats.AB > 0 ? TB / stats.AB : 0;

  return stats;
}

function formatAvg(val) {
  if (val === 0) return '.000';
  const str = val.toFixed(3);
  return str.startsWith('0') ? str.substring(1) : str;
}

function setupSortHeaders() {
  document.querySelectorAll('.stats-table th[data-sort]').forEach(th => {
    th.onclick = () => {
      const col = th.getAttribute('data-sort');
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'desc';
      }
      // Update sort indicators
      document.querySelectorAll('.stats-table th').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      renderStats();
    };
  });
}

// ---- Games Rendering ----
function renderGames() {
  const list = document.getElementById('gamesList');
  list.innerHTML = '';

  if (appData.games.length === 0) {
    list.innerHTML = `
      <div class="no-games-msg">
        <i class="fas fa-baseball-ball" style="font-size: 2rem; margin-bottom: 1rem; display: block; opacity: 0.3;"></i>
        Aún no se han registrado partidos.<br>
        <span style="font-size: 0.85rem; opacity: 0.6;">Activa el modo Admin para agregar resultados.</span>
      </div>
    `;
    return;
  }

  // Sort games by date (newest first)
  const sorted = [...appData.games].sort((a, b) => new Date(b.date) - new Date(a.date));

  sorted.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';

    const result = game.scoreUs > game.scoreThem ? 'W' : game.scoreUs < game.scoreThem ? 'L' : 'E';
    const resultClass = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'tie';
    const resultText = result === 'W' ? 'Victoria' : result === 'L' ? 'Derrota' : 'Empate';

    const dateObj = new Date(game.date + 'T12:00:00');
    const dateStr = dateObj.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

    card.innerHTML = `
      <div class="game-date">${dateStr}</div>
      <div class="game-teams">
        <span class="team-name-display" style="color: var(--cuba-blue-light);">Cuba</span>
        <span class="vs">vs</span>
        <span class="team-name-display">${game.opponent}</span>
      </div>
      <div class="game-score">
        <span style="color: ${game.scoreUs >= game.scoreThem ? '#22c55e' : 'var(--cuba-red)'}">${game.scoreUs}</span>
        <span style="color: var(--text-muted); margin: 0 4px;">-</span>
        <span style="color: ${game.scoreThem >= game.scoreUs ? '#22c55e' : 'var(--cuba-red)'}">${game.scoreThem}</span>
      </div>
      <span class="game-result ${resultClass}">${resultText}</span>
      <div class="game-actions">
        <button class="game-action-btn" onclick="viewGameStats('${game.id}')" title="Ver estadísticas del partido">
          <i class="fas fa-chart-bar"></i>
        </button>
        <button class="game-action-btn admin-only" onclick="editGame('${game.id}')" title="Editar partido">
          <i class="fas fa-edit"></i>
        </button>
        <button class="game-action-btn admin-only danger" onclick="deleteGame('${game.id}')" title="Eliminar partido">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `;
    list.appendChild(card);
  });

  // Update record
  const wins = appData.games.filter(g => g.scoreUs > g.scoreThem).length;
  const losses = appData.games.filter(g => g.scoreUs < g.scoreThem).length;
  document.getElementById('totalWins').textContent = wins;
  document.getElementById('totalLosses').textContent = losses;
}

// ---- Hero Stats Update ----
function updateHeroStats() {
  document.getElementById('heroPlayers').textContent = appData.players.length;
  document.getElementById('heroGames').textContent = appData.games.length;

  const wins = appData.games.filter(g => g.scoreUs > g.scoreThem).length;
  document.getElementById('heroWins').textContent = wins;

  // Team AVG
  let totalAB = 0, totalH = 0;
  appData.players.forEach(p => {
    const stats = calculatePlayerStats(p.id);
    totalAB += stats.AB;
    totalH += stats.H;
  });
  const teamAvg = totalAB > 0 ? (totalH / totalAB) : 0;
  document.getElementById('heroAvg').textContent = formatAvg(teamAvg);
}

// ---- Admin Functions ----
function toggleAdmin() {
  if (isAdminMode) {
    isAdminMode = false;
    adminPassword = null;
    document.body.classList.remove('admin-mode');
    document.getElementById('adminToggle').classList.remove('active');
    document.getElementById('adminToggle').innerHTML = '<i class="fas fa-lock"></i> Admin';
    showToast('Modo administrador desactivado', 'success');
  } else {
    document.getElementById('passwordModal').classList.add('active');
    setTimeout(() => document.getElementById('adminPassword').focus(), 100);
  }
}

async function checkPassword() {
  const pwd = document.getElementById('adminPassword').value;
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      adminPassword = pwd;
      isAdminMode = true;
      document.body.classList.add('admin-mode');
      document.getElementById('adminToggle').classList.add('active');
      document.getElementById('adminToggle').innerHTML = '<i class="fas fa-unlock"></i> Admin ON';
      closePasswordModal();
      showToast('Modo administrador activado ⚾', 'success');
    } else {
      showToast('Contraseña incorrecta', 'error');
      document.getElementById('adminPassword').value = '';
    }
  } catch (e) {
    showToast('No se pudo verificar la contraseña. Revisa tu conexión.', 'error');
  }
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('active');
  document.getElementById('adminPassword').value = '';
}

// ---- Game Management ----
function showStatsInputModal() {
  const opponent = document.getElementById('gameOpponent').value.trim();
  const date = document.getElementById('gameDate').value;

  if (!opponent) {
    showToast('Ingresa el nombre del equipo rival', 'error');
    return;
  }
  if (!date) {
    showToast('Selecciona la fecha del partido', 'error');
    return;
  }

  const editingGame = editingGameId ? appData.games.find(g => g.id === editingGameId) : null;

  // Build stats input grid
  const grid = document.getElementById('statsInputGrid');
  grid.innerHTML = '';

  // Headers
  const headers = ['Jugador', ...STAT_LABELS];
  headers.forEach((h) => {
    const div = document.createElement('div');
    div.className = 'grid-header';
    div.textContent = h;
    grid.appendChild(div);
  });

  // Player rows
  appData.players.forEach(player => {
    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-row-name';
    nameDiv.innerHTML = `<span class="p-num">${player.number}</span> ${player.name}`;
    grid.appendChild(nameDiv);

    const existingStats = editingGame && editingGame.playerStats ? editingGame.playerStats[player.id] : null;

    STAT_KEYS.forEach(key => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = existingStats ? (existingStats[key] || 0) : 0;
      input.id = `stat_${player.id}_${key}`;
      input.onfocus = function() { this.select(); };
      grid.appendChild(input);
    });
  });

  document.getElementById('statsModalTitle').innerHTML = editingGameId
    ? '<i class="fas fa-edit"></i> Editar Estadísticas del Partido'
    : '<i class="fas fa-edit"></i> Estadísticas del Partido';
  document.getElementById('saveGameBtn').innerHTML = editingGameId
    ? '<i class="fas fa-save"></i> Guardar Cambios'
    : '<i class="fas fa-save"></i> Guardar Partido';

  document.getElementById('statsModal').classList.add('active');
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.remove('active');
}

async function saveGame() {
  const opponent = document.getElementById('gameOpponent').value.trim();
  const date = document.getElementById('gameDate').value;
  const scoreUs = parseInt(document.getElementById('gameScoreUs').value) || 0;
  const scoreThem = parseInt(document.getElementById('gameScoreThem').value) || 0;

  const playerStats = {};
  appData.players.forEach(player => {
    const ps = {};
    STAT_KEYS.forEach(key => {
      const input = document.getElementById(`stat_${player.id}_${key}`);
      ps[key] = input ? parseInt(input.value) || 0 : 0;
    });
    playerStats[player.id] = ps;
  });

  const payload = { date, opponent, scoreUs, scoreThem, playerStats };
  const wasEditing = !!editingGameId;

  const saveBtn = document.getElementById('saveGameBtn');
  saveBtn.disabled = true;

  try {
    if (wasEditing) {
      const updated = await apiSend('games', 'PATCH', { id: editingGameId, ...payload });
      const idx = appData.games.findIndex(g => g.id === editingGameId);
      if (idx !== -1) appData.games[idx] = updated;
    } else {
      const created = await apiSend('games', 'POST', payload);
      appData.games.push(created);
    }

    renderStats();
    renderGames();
    updateHeroStats();
    cancelEditGame();
    closeStatsModal();

    const result = scoreUs > scoreThem ? '¡Victoria! 🎉' : scoreUs < scoreThem ? 'Derrota registrada' : 'Empate registrado';
    showToast(wasEditing ? `Partido vs ${opponent} actualizado.` : `Partido vs ${opponent} guardado. ${result}`, 'success');
  } catch (e) {
    showToast('No se pudo guardar el partido: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

function editGame(gameId) {
  const game = appData.games.find(g => g.id === gameId);
  if (!game) return;

  editingGameId = gameId;
  document.getElementById('gameOpponent').value = game.opponent;
  document.getElementById('gameDate').value = game.date;
  document.getElementById('gameScoreUs').value = game.scoreUs;
  document.getElementById('gameScoreThem').value = game.scoreThem;
  document.getElementById('loadStatsBtn').innerHTML = '<i class="fas fa-chart-bar"></i> Editar Estadísticas del Partido';
  document.getElementById('cancelEditBtn').style.display = 'inline-flex';

  const adminCard = document.querySelector('.admin-card');
  if (adminCard) adminCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditGame() {
  editingGameId = null;
  document.getElementById('gameOpponent').value = '';
  document.getElementById('gameDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('gameScoreUs').value = '0';
  document.getElementById('gameScoreThem').value = '0';
  document.getElementById('loadStatsBtn').innerHTML = '<i class="fas fa-chart-bar"></i> Cargar Estadísticas del Partido';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function deleteGame(gameId) {
  showConfirm('¿Estás seguro de eliminar este partido? Se borrarán sus estadísticas.', async () => {
    try {
      await apiSend('games', 'DELETE', { id: gameId });
      appData.games = appData.games.filter(g => g.id !== gameId);
      renderStats();
      renderGames();
      updateHeroStats();
      showToast('Partido eliminado', 'success');
    } catch (e) {
      showToast('No se pudo eliminar el partido: ' + e.message, 'error');
    }
  });
}

// ---- View Individual Game Stats ----
function viewGameStats(gameId) {
  const game = appData.games.find(g => g.id === gameId);
  if (!game) return;

  const dateObj = new Date(game.date + 'T12:00:00');
  const dateStr = dateObj.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('viewGameTitle').innerHTML = `
    <i class="fas fa-chart-bar"></i> Cuba ${game.scoreUs} - ${game.scoreThem} ${game.opponent}
    <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 6px; letter-spacing: 0.5px; text-transform: none; font-family: 'Inter', sans-serif;">${dateStr}</div>
  `;

  const body = document.getElementById('viewGameBody');
  body.innerHTML = '';

  const rows = appData.players
    .map(player => {
      const gs = (game.playerStats && game.playerStats[player.id]) || {};
      const played = STAT_KEYS.some(k => (gs[k] || 0) > 0);
      return { player, gs, played };
    })
    .filter(r => r.played)
    .sort((a, b) => (b.gs.H || 0) - (a.gs.H || 0));

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="13" style="text-align:center; color: var(--text-muted); padding: 2rem;">No hay estadísticas cargadas para este partido.</td></tr>`;
    document.getElementById('viewGameModal').classList.add('active');
    return;
  }

  rows.forEach(({ player, gs }) => {
    const ab = gs.AB || 0;
    const h = gs.H || 0;
    const avg = ab > 0 ? h / ab : 0;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="player-num-cell">${player.number}</td>
      <td>${player.name}</td>
      <td>${ab}</td>
      <td>${gs.R || 0}</td>
      <td>${h}</td>
      <td>${gs['2B'] || 0}</td>
      <td>${gs['3B'] || 0}</td>
      <td>${gs.HR || 0}</td>
      <td>${gs.RBI || 0}</td>
      <td>${gs.BB || 0}</td>
      <td>${gs.SO || 0}</td>
      <td>${gs.SB || 0}</td>
      <td>${formatAvg(avg)}</td>
    `;
    body.appendChild(row);
  });

  document.getElementById('viewGameModal').classList.add('active');
}

function closeViewGameModal() {
  document.getElementById('viewGameModal').classList.remove('active');
}

// ---- Custom Confirm Modal (native confirm() is unreliable in some browser contexts) ----
function showConfirm(message, onConfirm) {
  document.getElementById('confirmMessage').textContent = message;
  const oldBtn = document.getElementById('confirmActionBtn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', () => {
    closeConfirmModal();
    onConfirm();
  });
  document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('active');
}

// ---- Navigation ----
function setupNavigation() {
  const sections = ['inicio', 'roster', 'estadisticas', 'resultados'];
  const links = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY + 100;

    sections.forEach(id => {
      const section = document.getElementById(id);
      if (section) {
        const top = section.offsetTop;
        const height = section.offsetHeight;
        if (scrollY >= top && scrollY < top + height) {
          links.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-section') === id) {
              link.classList.add('active');
            }
          });
        }
      }
    });

    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) {
      navbar.style.background = 'rgba(8, 9, 15, 0.98)';
    } else {
      navbar.style.background = 'rgba(8, 9, 15, 0.92)';
    }
  });

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.getAttribute('data-section');
      scrollToSection(section);
      document.getElementById('navLinks').classList.remove('open');
    });
  });
}

function scrollToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) {
    const offset = 74; // nav height + flag stripe
    const top = el.offsetTop - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}

function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ---- Scroll Animations ----
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.player-card, .hero-stat, .game-card').forEach(el => {
    observer.observe(el);
  });
}

// ---- Toast Notifications ----
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ---- Data Export (manual backup of what's currently loaded) ----
function exportData() {
  const dataStr = JSON.stringify(appData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cuba-softbol-stats-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Datos exportados correctamente', 'success');
}
