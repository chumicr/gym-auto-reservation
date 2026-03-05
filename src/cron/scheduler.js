const cron = require('node-cron');
const User = require('../models/User');
const { runGymScraper } = require('../scraper/gymScraper');

const { Op } = require('sequelize');

const scheduleScraperOps = () => {
    console.log('⏳ Inicializando el servicio Cron para auto-scraping preciso (minuto a minuto)...');

    // Se ejecuta cada minuto
    cron.schedule('* * * * *', async () => {
        // Calculate current date and time using configured timezone
        const tz = process.env.TIMEZONE || 'Europe/Madrid';
        const madridNow = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

        const hours = String(madridNow.getHours()).padStart(2, '0');
        const minutes = String(madridNow.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        let currentDay = madridNow.getDay();
        if (currentDay === 0) currentDay = 7; // Convertir: 1 = Lunes, 7 = Domingo

        // Calculate target day dynamically
        const daysAhead = parseInt(process.env.DAYS_AHEAD_BOOKING || '2', 10);
        let targetDay = currentDay + daysAhead;
        while (targetDay > 7) targetDay -= 7;

        try {
            const Schedule = require('../models/Schedule');

            // Buscar programaciones que coincidan exactamente con la hora actual el Día Destino
            const pendingSchedules = await Schedule.findAll({
                where: {
                    dayOfWeek: targetDay,
                    time: currentTime,
                    autoScrape: true
                }
            });

            // Si no hay ninguna clase programada en este minuto exacto, salir en silencio
            if (pendingSchedules.length === 0) return;

            console.log(`\n[Cron] 🕒 Son las ${currentTime} del día ${currentDay} (${tz}). Reservando clases para dentro de ${daysAhead} días (día ${targetDay})...`);
            console.log(`[Cron] Se han encontrado ${pendingSchedules.length} clases programadas justo a esta hora.`);

            // Obtener los usuarios únicos involucrados y que tengan contraseña configurada
            const userIds = [...new Set(pendingSchedules.map(s => s.userId))];
            const users = await User.findAll({
                where: {
                    id: userIds,
                    password: { [Op.not]: null }
                }
            });

            const userMap = {};
            users.forEach(u => userMap[u.id] = u);

            for (const schedule of pendingSchedules) {
                const user = userMap[schedule.userId];
                if (!user) {
                    console.log(`⚠️ Ignorando reserva de ${schedule.className} porque su usuario no tiene contraseña almacenada.`);
                    continue;
                }

                console.log(`▶ Ejecutando bot automático: ${user.username} → ${schedule.className}`);
                await runGymScraper(user.id, schedule);

                // Pausa prudencial entre bots para no sobrecargar el sistema/gimnasio
                await new Promise(r => setTimeout(r, 6000));
            }
            console.log(`[Cron] ✅ Ejecución de las ${currentTime} finalizada con éxito.\n`);

        } catch (error) {
            console.error('[Cron] Error interno en validación minuto a minuto:', error);
        }
    });
};

module.exports = { scheduleScraperOps };
