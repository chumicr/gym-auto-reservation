/* Simple in-memory log store per user — consumed by /api/user/scrape-log */
const logs = {};

function addLog(userId, msg) {
    if (!logs[userId]) logs[userId] = [];
    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logs[userId].push({ time, msg });
    console.log(`[Scraper] ${msg}`);
}

/** Returns pending entries and clears the queue */
function popLogs(userId) {
    const entries = logs[userId] || [];
    logs[userId] = [];
    return entries;
}

module.exports = { addLog, popLogs };
