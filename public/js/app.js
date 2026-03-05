/* ================================================
   GymScrape — app.js
   ================================================ */

let userRole = 'user';
let token = localStorage.getItem('token');

const API_URL = ''; // Relative paths — same server serves frontend

/* ── DOM REFS ───────────────────────────────── */
const authView = document.getElementById('auth-view');
const userView = document.getElementById('user-view');
const adminView = document.getElementById('admin-view');

/* ── AUTO-LOGIN if token exists ─────────────── */
if (token) {
    userRole = localStorage.getItem('role') || 'user';
    showDashboard();
}

/* ── UTIL: set button in loading state ──────── */
function setLoading(btn, loading, originalText) {
    if (loading) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> Cargando...`;
    } else {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/* ── UTIL: toggle views ─────────────────────── */
function toggleViews(view) {
    authView.classList.add('hidden');
    userView.classList.add('hidden');
    adminView.classList.add('hidden');

    if (view === 'auth') authView.classList.remove('hidden');
    if (view === 'user') userView.classList.remove('hidden');
    if (view === 'admin') adminView.classList.remove('hidden');
}

/* ── AUTH FORM submit ───────────────────────── */
document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const btn = document.getElementById('auth-btn');
    const originalText = btn.innerHTML;

    if (!username || !password) {
        shakeForm('auth-form');
        alert('⚠️ Por favor, rellena usuario y contraseña antes de continuar.');
        return;
    }

    setLoading(btn, true);

    try {
        const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('role', res.data.role);
        token = res.data.token;
        userRole = res.data.role;
        showDashboard();
    } catch (error) {
        const msg = error.response?.data?.msg || error.response?.data?.error || 'Error desconocido.';
        alert('❌ ' + msg);
    } finally {
        setLoading(btn, false, originalText);
    }
});

/* ── UI HELPERS ──────────────────────────────── */
// Toggle password visibility
document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', function () {
        const input = this.closest('.input-wrapper').querySelector('input');
        if (input.type === 'password') {
            input.type = 'text';
            this.textContent = '🙈';
        } else {
            input.type = 'password';
            this.textContent = '👁️';
        }
    });
});

/* ── DASHBOARD ──────────────────────────────── */
async function showDashboard() {
    toggleViews('user');
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    if (userRole === 'admin') {
        document.getElementById('go-admin-btn').classList.remove('hidden');
    } else {
        document.getElementById('go-admin-btn').classList.add('hidden');
    }

    try {
        const res = await axios.get(`${API_URL}/api/user/me`);
        const user = res.data;

        // Mostrar el email (username) en el banner
        document.getElementById('display-username').textContent = user.username;

        // Set per-user log key and restore the log
        LOG_KEY = `${LOG_KEY_PREFIX}_${user.username}`;
        restoreLog();

        // Contraseña: se muestra descifrada para que el usuario pueda verla con el ojito
        const gymPasswordInput = document.getElementById('gym-password');
        gymPasswordInput.value = user.password || '';

        const warningEl = document.getElementById('credentials-warning');

        if (user.password) {
            warningEl.classList.add('hidden');
        } else {
            warningEl.classList.remove('hidden');
        }

        // Status
        const statusEl = document.getElementById('last-status');
        statusEl.textContent = user.lastExecutionStatus || 'Desconocido';
        statusEl.className = 'status-badge';
        const s = (user.lastExecutionStatus || '').toLowerCase();
        if (s.includes('ok') || s.includes('éxito') || s.includes('success')) {
            statusEl.classList.add('status-success');
        } else if (s.includes('error') || s.includes('fallo')) {
            statusEl.classList.add('status-error');
        } else {
            statusEl.classList.add('status-pending');
        }

        document.getElementById('last-time').textContent = user.lastExecutionTime
            ? new Date(user.lastExecutionTime).toLocaleString('es-ES')
            : 'Nunca';

        // Log status refresh
        const statusText = user.lastExecutionStatus || 'Desconocido';
        const logType = statusText.toLowerCase().includes('success') ? 'success'
            : statusText.toLowerCase().includes('error') ? 'error'
                : statusText.toLowerCase().includes('running') ? 'warning'
                    : 'muted';
        addLog(`Estado actual: ${statusText}`, logType);

        loadSchedules();
        loadAvailableClasses();

    } catch {
        logout();
    }
}

/* ── SCHEDULES ────────────────────────────── */
async function loadSchedules() {
    try {
        const res = await axios.get(`${API_URL}/api/user/schedules`);
        const tbody = document.querySelector('#schedules-table tbody');
        tbody.innerHTML = '';

        const days = ['—', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

        if (res.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">No tienes clases programadas</td></tr>';
            return;
        }

        const credentialsOk = !!document.getElementById('gym-password').value;

        res.data.forEach(s => {
            const playBtnAttr = credentialsOk ? '' : 'disabled style="opacity: 0.4" title="Configura la contraseña"';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${s.className}</strong></td>
                    <td>${days[s.dayOfWeek]}</td>
                    <td>${s.time}</td>
                    <td>
                        <div style="display:flex; justify-content:center;">
                            <label class="switch" aria-label="Programar auto-scraping" style="transform: scale(0.85);">
                                <input type="checkbox" onchange="toggleScheduleAutoScrape('${s.id}', this.checked)" ${s.autoScrape ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </td>
                    <td>
                        <div style="display:flex; gap:0.5rem; justify-content:center;">
                            <button onclick="executeSchedule('${s.id}')" class="btn-sm success" id="btn-exec-${s.id}" ${playBtnAttr}>▶</button>
                            <button onclick="deleteSchedule('${s.id}')" class="btn-sm danger">🗑</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    } catch {
        console.error('Error al cargar horarios');
    }
}

let globalScheduleData = null;

async function fetchScheduleDataIfNeeded() {
    try {
        const res = await axios.get(`${API_URL}/api/user/classes?t=${Date.now()}`);
        globalScheduleData = res.data;
    } catch {
        console.error('Error fetching classes.');
    }
}

async function loadAvailableClasses() {
    await fetchScheduleDataIfNeeded();
}

document.getElementById('schedule-day').addEventListener('change', async (e) => {
    await fetchScheduleDataIfNeeded();
    const classSelect = document.getElementById('schedule-class');
    const timeSelect = document.getElementById('schedule-time');

    // Reset secondary selects
    classSelect.innerHTML = '<option value="" disabled selected>Selecciona una clase...</option>';
    timeSelect.innerHTML = '<option value="" disabled selected>—</option>';
    classSelect.disabled = true;
    timeSelect.disabled = true;

    const dayId = e.target.value;
    if (!globalScheduleData || !globalScheduleData[dayId]) {
        classSelect.innerHTML = '<option value="" disabled selected>No hay clases este día</option>';
        return;
    }

    const availableClasses = Object.keys(globalScheduleData[dayId]);
    if (availableClasses.length === 0) {
        classSelect.innerHTML = '<option value="" disabled selected>No hay clases este día</option>';
        return;
    }

    // Populate classes
    availableClasses.forEach(c => {
        classSelect.innerHTML += `<option value="${c}">${c}</option>`;
    });
    classSelect.disabled = false;
});

document.getElementById('schedule-class').addEventListener('change', (e) => {
    const dayId = document.getElementById('schedule-day').value;
    const className = e.target.value;
    const timeSelect = document.getElementById('schedule-time');

    timeSelect.innerHTML = '<option value="" disabled selected>Selecciona una hora...</option>';
    timeSelect.disabled = true;

    if (!globalScheduleData || !globalScheduleData[dayId] || !globalScheduleData[dayId][className]) {
        timeSelect.innerHTML = '<option value="" disabled selected>—</option>';
        return;
    }

    const availableTimes = globalScheduleData[dayId][className];
    availableTimes.forEach(t => {
        timeSelect.innerHTML += `<option value="${t}">${t}</option>`;
    });
    timeSelect.disabled = false;
});

async function deleteSchedule(id) {
    await axios.delete(`${API_URL}/api/user/schedules/${id}`);
    loadSchedules();
}

async function toggleScheduleAutoScrape(id, autoScrape) {
    try {
        await axios.patch(`${API_URL}/api/user/schedules/${id}`, { autoScrape });
    } catch {
        alert('❌ Error al actualizar el estado de programación.');
        loadSchedules(); // revert toggle visually
    }
}

document.getElementById('add-schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const className = document.getElementById('schedule-class').value;
    const dayOfWeek = document.getElementById('schedule-day').value;
    const time = document.getElementById('schedule-time').value;

    const btn = document.getElementById('add-schedule-btn');
    const originalText = btn.innerHTML;
    setLoading(btn, true);

    try {
        await axios.post(`${API_URL}/api/user/schedules`, { className, dayOfWeek, time });
        document.getElementById('add-schedule-form').reset();

        const days = ['—', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const dayStr = days[dayOfWeek] || dayOfWeek;

        addLog(`Nueva programación añadida: ${className} el ${dayStr} a las ${time}`, 'success');
        loadSchedules();
    } catch (err) {
        const msg = err.response?.data?.error || 'Error al guardar programación.';
        addLog(`⚠️ ${msg}`, 'warning');
        alert(`⚠️ ${msg}`);
    } finally {
        setLoading(btn, false, originalText);
    }
});

/* ── CONFIG FORM ────────────────────────────── */
document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('gym-password').value;
    const btn = document.getElementById('save-config-btn');
    const originalText = btn.innerHTML;

    setLoading(btn, true);
    try {
        await axios.put(`${API_URL}/api/user/config`, { password });
        addLog('Configuración guardada correctamente.', 'success');
        alert('✅ Configuración guardada correctamente.');
        showDashboard();
    } catch {
        addLog('Error al guardar la configuración.', 'error');
        alert('❌ No se pudo guardar la configuración.');
    } finally {
        setLoading(btn, false, originalText);
    }
});

/* ── EXECUTE SPECIFIC SCHEDULE ── */
async function executeSchedule(id) {
    const btn = document.getElementById(`btn-exec-${id}`);
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '⏳';

    addLog('Iniciando proceso de reserva...', 'info');

    try {
        await axios.post(`${API_URL}/api/user/force-scrape/${id}`);
    } catch (err) {
        const msg = err.response?.data?.error || err.response?.data?.msg || 'Error al arrancar el bot.';
        addLog(`❌ ${msg}`, 'error');
        btn.innerHTML = '❌';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 3000);
        return;
    }

    // Poll the log every 2s until 'éxito' or 'Error' terminates, max 3 minutes
    let elapsed = 0;
    const maxTime = 180000;
    const interval = setInterval(async () => {
        elapsed += 2000;
        try {
            const res = await axios.get(`${API_URL}/api/user/scrape-log`);
            res.data.forEach(entry => {
                const type = entry.msg.includes('❌') || entry.msg.includes('💥') ? 'error'
                    : entry.msg.includes('🎉') || entry.msg.includes('✅') ? 'success'
                        : entry.msg.includes('⚠️') ? 'warning'
                            : 'info';
                addLog(entry.msg, type);

                // Stop polling on terminal states
                if (entry.msg.includes('🎉') || entry.msg.includes('❌') || entry.msg.includes('💥')) {
                    clearInterval(interval);
                    btn.innerHTML = entry.msg.includes('🎉') ? '✅' : '❌';
                    setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 3000);
                }
            });
        } catch {
            // ignore transient errors
        }
        if (elapsed >= maxTime) {
            clearInterval(interval);
            addLog('⏰ Tiempo máximo de espera alcanzado.', 'warning');
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }, 2000);
}

/* ── ADMIN PANEL ────────────────────────────── */
async function loadAdminPanel() {
    toggleViews('admin');
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding:2rem;">⏳ Cargando usuarios...</td></tr>';

    try {
        const res = await axios.get(`${API_URL}/api/admin/users`);
        tbody.innerHTML = '';
        res.data.forEach(u => {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${u.username}</strong></td>
                    <td><span class="status-badge" style="background:var(--accent-glow); color:var(--accent);">${u.role}</span></td>
                    <td>${u.username}</td>
                    <td>${u.autoScrape ? '✅' : '—'}</td>
                    <td style="font-size:0.8rem">${u.lastExecutionStatus || '—'}</td>
                    <td>${u.role !== 'admin'
                    ? `<button onclick="deleteUser('${u.id}')" class="btn-sm danger">🗑 Eliminar</button>`
                    : '<span style="color:var(--text-muted)">—</span>'
                }</td>
                </tr>
            `;
        });
    } catch {
        alert('❌ Error cargando usuarios.');
    }
}

async function deleteUser(id) {
    if (confirm('¿Seguro que quieres eliminar este usuario? Esta acción no se puede deshacer.')) {
        await axios.delete(`${API_URL}/api/admin/users/${id}`);
        loadAdminPanel();
    }
}

/* ── CREATE USER (admin) ────────────────────── */
document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value.trim();
    const role = document.getElementById('new-role').value.trim() || 'user';
    const btn = document.getElementById('create-user-btn');
    const originalText = btn.innerHTML;

    if (!username || !password) {
        shakeForm('create-user-form');
        alert('⚠️ El nombre de usuario y la contraseña son obligatorios.');
        return;
    }
    if (password.length < 6) {
        alert('⚠️ La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    setLoading(btn, true);
    try {
        await axios.post(`${API_URL}/api/auth/register`, { username, password, role });
        alert(`✅ Usuario "${username}" creado correctamente.`);
        document.getElementById('create-user-form').reset();
        document.getElementById('new-role').value = 'user';
        loadAdminPanel(); // Refresh user table
    } catch (error) {
        const msg = error.response?.data?.error || error.response?.data?.msg || 'Error desconocido.';
        alert('❌ ' + msg);
    } finally {
        setLoading(btn, false, originalText);
    }
})

/* ── NAVIGATION ─────────────────────────────── */
document.getElementById('back-user-btn').addEventListener('click', () => showDashboard());
document.getElementById('logout-btn').addEventListener('click', logout);

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    token = null;
    axios.defaults.headers.common['Authorization'] = '';
    toggleViews('auth');
}

/* ── SHAKE ANIMATION (invalid submit) ───────── */
function shakeForm(formId) {
    const form = document.getElementById(formId);
    form.style.animation = 'none';
    form.offsetHeight; // reflow
    form.style.animation = 'shake 0.35s ease';
}

/* ── BOT LOG ─────────────────────────────────── */
const LOG_KEY_PREFIX = 'gymscrape_activity_log';
const MAX_LOG_ENTRIES = 200;
let LOG_KEY = LOG_KEY_PREFIX; // overwritten per user on login

function saveLogToStorage(time, msg, type) {
    const entries = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    entries.push({ time, msg, type });
    if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
}

function renderLogEntry(log, time, msg, type) {
    const line = document.createElement('span');
    line.className = `log-line ${type}`;
    line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg"> ${msg}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function restoreLog() {
    const log = document.getElementById('bot-log');
    if (!log) return;
    log.innerHTML = ''; // clear before restoring (important when switching users)
    const entries = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    entries.forEach(e => renderLogEntry(log, e.time, e.msg, e.type));
}

function addLog(msg, type = 'info') {
    const log = document.getElementById('bot-log');
    if (!log) return;
    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    renderLogEntry(log, time, msg, type);
    saveLogToStorage(time, msg, type);
}

document.getElementById('clear-log-btn').addEventListener('click', () => {
    document.getElementById('bot-log').innerHTML = '';
    localStorage.removeItem(LOG_KEY);
});

// Do NOT restore log on page load — wait for user identity (done in showDashboard)
