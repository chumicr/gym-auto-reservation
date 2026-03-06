const puppeteer = require('puppeteer');
const moment = require('moment');
const { decrypt } = require('../utils/encryption');
const User = require('../models/User');
const { addLog } = require('../utils/scraperLog');
const fs = require('fs');
const path = require('path');

async function runGymScraper(userId, schedule) {
    const user = await User.findByPk(userId);

    if (!user) {
        console.error(`[Scraper] User ID ${userId} not found.`);
        return;
    }

    if (!user.password) {
        addLog(userId, '⚠️ Contraseña del gimnasio no configurada. Abortando.');
        await user.update({ lastExecutionStatus: 'Error: Contraseña no configurada', lastExecutionTime: new Date() });
        return;
    }

    let browser = null;
    let screenshotCount = 1;

    async function takeStepScreenshot(page, stepName) {
        try {
            const dir = path.join(process.cwd(), 'screenshots', userId.toString(), moment().format('YYYY-MM-DD_HH-mm'));
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const fileName = `${screenshotCount.toString().padStart(2, '0')}_${stepName}.png`;
            const filePath = path.join(dir, fileName);
            await page.screenshot({ path: filePath });
            screenshotCount++;
        } catch (err) {
            console.error('[Scraper] Error taking screenshot:', err.message);
        }
    }

    try {
        const className = schedule ? schedule.className : 'Default';
        addLog(userId, `🤖 Iniciando bot para: ${user.username} → ${className}`);
        await user.update({ lastExecutionStatus: `Running: ${className}...` });

        const targetUrl = process.env.TARGET_URL || 'https://myclub.deporweb.net/public/login';
        const username = user.username;
        const password = decrypt(user.password);

        browser = await puppeteer.launch({
            headless: process.env.HEADLESS === 'true' ? true : false, // default to true in production
            defaultViewport: null,
            slowMo: process.env.HEADLESS === 'false' ? 50 : 0,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1280,1024',
                '--lang=es-ES,es'
            ]
        });

        const page = await browser.newPage();

        // Forzar idioma español
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'es-ES,es;q=0.9'
        });

        // Spoof language properties before any script runs
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'language', { get: () => 'es-ES' });
            Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es'] });
        });

        // Use a real browser User Agent to avoid being blocked as a bot
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Optimizar uso de red en producción (Allow images for screenshots if needed)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const blocked = ['font', 'media']; // Removed 'image' to allow screenshots to be useful
            if (blocked.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        addLog(userId, `🔗 Navegando a: ${targetUrl}`);
        // networkidle2 is safer for heavy JS apps (Ionic)
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await takeStepScreenshot(page, 'login_page_loaded');

        addLog(userId, '🔑 Introduciendo credenciales...');

        const userSelector = 'input[aria-label="Usuario"]';
        const passSelector = 'input[aria-label="Contraseña"]';

        await page.waitForSelector(userSelector, { timeout: 15000 });
        await page.waitForSelector(passSelector, { timeout: 15000 });

        await page.type(userSelector, username, { delay: 30 });
        await page.type(passSelector, password, { delay: 30 });

        const buttonSelector = 'ion-button[type="submit"]';
        // Remove disabled check here because it might be slow, just click it
        await page.waitForSelector(buttonSelector, { timeout: 5000 });
        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) btn.click();
        }, buttonSelector);

        await takeStepScreenshot(page, 'login_submitted');
        addLog(userId, '🚀 Enviando formulario de login...');

        // Verify login success
        const loginOk = await page.waitForFunction(
            () => !window.location.href.includes('/public/login') && !window.location.href.includes('/login'),
            { timeout: 10000 }
        ).then(() => true).catch(() => false);

        if (!loginOk) {
            await takeStepScreenshot(page, 'login_error');
            addLog(userId, '❌ Login fallido: credenciales incorrectas o timeout.');
            await user.update({ lastExecutionStatus: 'Error: Login fallido', lastExecutionTime: new Date() });
            return;
        }

        const dashboardLoaded = await page.waitForSelector('.grid-social-networks, ion-grid, .button-main-text', { timeout: 10000 })
            .then(() => true).catch(() => false);

        if (!dashboardLoaded) {
            addLog(userId, '❌ El panel principal no cargó tras el login.');
            await user.update({ lastExecutionStatus: 'Error: Panel no cargado', lastExecutionTime: new Date() });
            return;
        }

        addLog(userId, '✅ Login correcto. Buscando "Reserva de Actividades"...');
        await takeStepScreenshot(page, 'dashboard_loaded');
        await new Promise(r => setTimeout(r, 1000));

        const clicked = await page.evaluate(() => {
            const texts = Array.from(document.querySelectorAll('.button-main-text'));
            const reservaElement = texts.find(el => el.textContent.includes('Reserva de Actividades'));
            if (reservaElement) {
                const btn = reservaElement.closest('ion-button');
                if (btn) { btn.click(); return true; }
            }
            return false;
        });

        if (clicked) {
            addLog(userId, '📅 Navegando al calendario de reservas...');
            await page.waitForFunction(() => window.location.href.includes('reservation/classes'), { timeout: 10000 }).catch(() => { });
            await new Promise(r => setTimeout(r, 1000));
            await takeStepScreenshot(page, 'calendar_loaded');

            await page.waitForSelector('.calendar-wrapper .date', { timeout: 10000 });

            let dayOfWeek = schedule ? parseInt(schedule.dayOfWeek) : 4;
            let targetDate = moment().isoWeekday(dayOfWeek);
            if (moment().isoWeekday() >= dayOfWeek) { targetDate.add(1, 'week'); }

            const targetDayNumber = targetDate.format('D');
            const targetMonthStr = targetDate.format('MMM').toLowerCase().substring(0, 3);
            addLog(userId, `🔍 Buscando día ${targetDayNumber}/${targetMonthStr} en el calendario...`);

            const dayClicked = await page.evaluate((dayNum, monthStr) => {
                const dates = Array.from(document.querySelectorAll('.calendar-wrapper .date'));
                const targetEl = dates.find(el => {
                    const d = el.querySelector('.day')?.textContent.trim();
                    const m = el.querySelector('.month')?.textContent.trim().toLowerCase();
                    return d === dayNum && m === monthStr;
                });
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
                    targetEl.click(); return true;
                }
                return false;
            }, targetDayNumber, targetMonthStr);

            if (dayClicked) {
                await new Promise(r => setTimeout(r, 1500));

                const targetClassName = schedule ? schedule.className : 'PILATES';
                const targetClassTime = schedule ? schedule.time : '20:00';
                addLog(userId, `🏋️ Buscando clase: "${targetClassName}" a las ${targetClassTime}...`);
                await takeStepScreenshot(page, 'day_selected');

                const claseClickeada = await page.evaluate((name, time) => {
                    const items = document.querySelectorAll('ion-item.listItem');
                    const targetItem = Array.from(items).find(item => {
                        const titleEl = item.querySelector('.listItemTitle span');
                        const timeEl = item.querySelectorAll('.flex-40')[0];
                        if (!titleEl || !timeEl) return false;
                        return titleEl.textContent.trim().toUpperCase() === name.toUpperCase() && timeEl.textContent.trim().includes(time);
                    });
                    if (targetItem) {
                        targetItem.scrollIntoView({ behavior: 'instant', block: 'center' });
                        targetItem.click(); return true;
                    }
                    return false;
                }, targetClassName, targetClassTime);

                if (claseClickeada) {
                    await new Promise(r => setTimeout(r, 1500));
                    await takeStepScreenshot(page, 'class_details_loaded');
                    addLog(userId, '✅ Clase encontrada. Analizando estado de la reserva...');

                    const estadoReserva = await page.evaluate(() => {
                        const allButtons = Array.from(document.querySelectorAll('ion-button, button'));
                        const texts = allButtons.map(b => b.textContent.trim().toUpperCase());

                        const reserveBtn = allButtons.find(b => b.textContent.trim().toUpperCase() === 'RESERVAR PLAZA PRESENCIAL' && !b.disabled && b.getAttribute('disabled') === null);
                        if (reserveBtn) { reserveBtn.click(); return { state: 'reserve_clicked' }; }

                        const waitingBtn = allButtons.find(b => {
                            const t = b.textContent.trim().toUpperCase();
                            return (t.includes('LISTA DE ESPERA') || t.includes('APUNTARME') || t.includes('APUNTARSE') || t.includes('APUNTA') || t.includes('ESPERA') || t.includes('WAITING')) && !b.disabled && b.getAttribute('disabled') === null;
                        });
                        if (waitingBtn) { waitingBtn.click(); return { state: 'waitlist_clicked', label: waitingBtn.textContent.trim() }; }

                        const alreadyWaiting = allButtons.find(b => {
                            const t = b.textContent.trim().toUpperCase();
                            return t.includes('EN LISTA DE ESPERA') || t.includes('YA ESTÁS') || t.includes('BAJA DE LISTA');
                        });
                        if (alreadyWaiting) return { state: 'already_waitlisted' };

                        const alreadyReserved = allButtons.find(b => {
                            const t = b.textContent.trim().toUpperCase();
                            return t.includes('CANCELAR RESERVA') || t.includes('ANULAR RESERVA') || t === 'IR A LA RESERVA';
                        });
                        if (alreadyReserved) return { state: 'already_reserved' };

                        const disabledReserve = allButtons.find(b => b.textContent.trim().toUpperCase() === 'RESERVAR PLAZA PRESENCIAL' && (b.disabled || b.getAttribute('disabled') !== null));
                        if (disabledReserve) return { state: 'not_open_yet' };

                        const pageText = document.body.innerText.toUpperCase();
                        if (pageText.includes('RESERVA DISPONIBLE') || pageText.includes('A PARTIR DE') || pageText.includes('NO DISPONIBLE')) {
                            return { state: 'not_open_yet' };
                        }

                        return { state: 'unknown', buttons: texts.slice(0, 10) };
                    });

                    if (estadoReserva.state === 'reserve_clicked') {
                        addLog(userId, '💬 Botón de reserva pulsado. Esperando confirmación...');
                        await takeStepScreenshot(page, 'waiting_confirmation_dialog');
                        await page.waitForSelector('ion-alert .alert-button-role-accept', { visible: true, timeout: 6000 });
                        const confirmacionDefinitiva = await page.evaluate(() => {
                            const acceptBtn = Array.from(document.querySelectorAll('ion-alert button')).find(b => b.textContent.trim().toUpperCase() === 'ACEPTAR');
                            if (acceptBtn) { acceptBtn.click(); return true; }
                            return false;
                        });
                        if (confirmacionDefinitiva) {
                            addLog(userId, '🎉 ¡Reserva confirmada con éxito!');
                            await takeStepScreenshot(page, 'booking_confirmed');
                            await user.update({ lastExecutionStatus: 'Success', lastExecutionTime: new Date() });
                        } else {
                            addLog(userId, '❌ No se pudo confirmar la reserva (botón Aceptar no detectado).');
                            await takeStepScreenshot(page, 'confirmation_failed');
                            await user.update({ lastExecutionStatus: 'Error: Confirmation failed', lastExecutionTime: new Date() });
                        }

                    } else if (estadoReserva.state === 'waitlist_clicked') {
                        addLog(userId, `📋 Clase llena. Apuntándote a la lista de espera...`);
                        await page.waitForSelector('ion-alert .alert-button-role-accept', { visible: true, timeout: 6000 }).catch(() => { });
                        const confirmado = await page.evaluate(() => {
                            const acceptBtn = Array.from(document.querySelectorAll('ion-alert button')).find(b => b.textContent.trim().toUpperCase() === 'ACEPTAR');
                            if (acceptBtn) { acceptBtn.click(); return true; }
                            return false;
                        });
                        if (confirmado) {
                            addLog(userId, '🎉 ¡Apuntado a la lista de espera correctamente!');
                            await user.update({ lastExecutionStatus: 'En lista de espera', lastExecutionTime: new Date() });
                        } else {
                            addLog(userId, '⚠️ Lista de espera pulsada pero confirmación fallida.');
                            await user.update({ lastExecutionStatus: 'Espera: confirmación pendiente', lastExecutionTime: new Date() });
                        }

                    } else if (estadoReserva.state === 'already_waitlisted') {
                        addLog(userId, '📋 Ya estás en la lista de espera. No se requiere acción.');
                        await user.update({ lastExecutionStatus: 'Ya en lista de espera', lastExecutionTime: new Date() });

                    } else if (estadoReserva.state === 'already_reserved') {
                        addLog(userId, '✅ Ya tienes esta clase reservada. No se requiere acción.');
                        await user.update({ lastExecutionStatus: 'Ya reservado', lastExecutionTime: new Date() });

                    } else if (estadoReserva.state === 'not_open_yet') {
                        addLog(userId, '⏰ Las plazas aún no están abiertas.');
                        await user.update({ lastExecutionStatus: 'Reserva no abierta', lastExecutionTime: new Date() });

                    } else {
                        addLog(userId, `❌ Estado desconocido. Botones presentes: ${(estadoReserva.buttons || []).join(', ')}`);
                        await user.update({ lastExecutionStatus: 'Error: Estado desconocido', lastExecutionTime: new Date() });
                    }

                } else {
                    addLog(userId, `❌ No se encontró la clase "${targetClassName}" a las ${targetClassTime}.`);
                    await user.update({ lastExecutionStatus: `Error: No ${targetClassName} at ${targetClassTime}`, lastExecutionTime: new Date() });
                }
            } else {
                addLog(userId, `❌ No se encontró el día ${targetDayNumber} en el calendario.`);
                await user.update({ lastExecutionStatus: `Error: Day ${targetDayNumber} not found`, lastExecutionTime: new Date() });
            }
        } else {
            addLog(userId, '❌ No se encontró botón directo a Reserva de Actividades.');
            await user.update({ lastExecutionStatus: 'Error: No Activity Button', lastExecutionTime: new Date() });
        }

    } catch (error) {
        addLog(userId, `💥 Error inesperado: ${error.message}`);
        if (browser) {
            const pages = await browser.pages();
            if (pages.length > 0) await takeStepScreenshot(pages[0], 'unexpected_error');
        }
        await user.update({ lastExecutionStatus: 'System Error', lastExecutionTime: new Date() });
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

module.exports = { runGymScraper };
