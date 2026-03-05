require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const User = require('./src/models/User');
const sequelize = require('./src/config/database');
const { encrypt, decrypt } = require('./src/utils/encryption');
const { runGymScraper } = require('./src/scraper/gymScraper');
const { scrapeAvailableClasses } = require('./src/scraper/classScraper');
const Schedule = require('./src/models/Schedule');
const { popLogs } = require('./src/utils/scraperLog');
require('./src/cron/scheduler').scheduleScraperOps();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'supersecret';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* --- AUTH MIDDLEWARE --- */
const auth = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ msg: 'No token, autorización denegada' });
    try {
        req.user = jwt.verify(token, SECRET_KEY);
        next();
    } catch {
        res.status(400).json({ msg: 'Token no válido' });
    }
};

const adminAuth = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Requiere rol de admin' });
    next();
};

/* --- AUTH ROUTES --- */
app.post('/api/auth/register', auth, adminAuth, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }
    try {
        await User.create({
            username,
            password: encrypt(password),
            role: role || 'user'
        });
        res.status(201).json({ msg: 'Usuario registrado exitosamente' });
    } catch (error) {
        res.status(400).json({ error: 'Error al registrar usuario', details: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username } });
        if (!user) return res.status(400).json({ msg: 'Usuario no encontrado' });

        const isMatch = decrypt(user.password) === password;
        if (!isMatch) return res.status(400).json({ msg: 'Contraseña incorrecta' });

        const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, SECRET_KEY, { expiresIn: '8h' });
        res.json({ token, role: user.role });
    } catch (error) {
        res.status(500).json({ error: 'Error de servidor' });
    }
});

/* --- USER ROUTES --- */
app.get('/api/user/me', auth, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        res.json({ ...user.toJSON(), password: decrypt(user.password) });
    } catch {
        res.status(500).send('Error');
    }
});

app.put('/api/user/config', auth, async (req, res) => {
    const { password, autoScrape } = req.body;
    try {
        const user = await User.findByPk(req.user.id);
        if (password) user.password = encrypt(password);
        if (autoScrape !== undefined) user.autoScrape = autoScrape;
        await user.save();
        res.json({ msg: 'Configuración actualizada con éxito' });
    } catch (error) {
        res.status(500).json({ error: 'Error actualizando configuración' });
    }
});

app.post('/api/user/force-scrape/:id', auth, async (req, res) => {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.password) return res.status(400).json({ error: 'Configuración incompleta.' });

    const schedule = await Schedule.findOne({ where: { id: req.params.id, userId: user.id } });
    if (!schedule) return res.status(404).json({ error: 'Horario no encontrado.' });

    runGymScraper(user.id, schedule);
    res.json({ msg: 'Proceso de reserva iniciado para esta clase.' });
});

app.get('/api/user/scrape-log', auth, (req, res) => {
    const entries = popLogs(req.user.id);
    res.json(entries);
});

app.get('/api/user/classes', auth, async (req, res) => {
    try {
        const schedule = await scrapeAvailableClasses();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.json(schedule);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener clases' });
    }
});

app.get('/api/user/schedules', auth, async (req, res) => {
    try {
        const schedules = await Schedule.findAll({ where: { userId: req.user.id } });
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo horarios' });
    }
});

app.post('/api/user/schedules', auth, async (req, res) => {
    const { className, dayOfWeek, time } = req.body;
    if (!className || !dayOfWeek || !time) return res.status(400).json({ error: 'Faltan datos.' });
    try {
        const existing = await Schedule.findOne({ where: { userId: req.user.id, className, dayOfWeek, time } });
        if (existing) return res.status(409).json({ error: `Ya tienes "${className}" programado el ${dayOfWeek} a las ${time}.` });
        const s = await Schedule.create({ userId: req.user.id, className, dayOfWeek, time });
        res.status(201).json(s);
    } catch {
        res.status(500).json({ error: 'Error guardando horario' });
    }
});

app.delete('/api/user/schedules/:id', auth, async (req, res) => {
    try {
        await Schedule.destroy({ where: { id: req.params.id, userId: req.user.id } });
        res.json({ msg: 'Horario eliminado' });
    } catch {
        res.status(500).json({ error: 'Error eliminando horario' });
    }
});

app.patch('/api/user/schedules/:id', auth, async (req, res) => {
    try {
        const schedule = await Schedule.findOne({ where: { id: req.params.id, userId: req.user.id } });
        if (!schedule) return res.status(404).json({ error: 'Horario no encontrado' });

        schedule.autoScrape = req.body.autoScrape;
        await schedule.save();
        res.json(schedule);
    } catch {
        res.status(500).json({ error: 'Error actualizando horario' });
    }
});

/* --- ADMIN ROUTES --- */
app.get('/api/admin/users', auth, adminAuth, async (req, res) => {
    try {
        const users = await User.findAll({ attributes: { exclude: ['password'] } });
        res.json(users);
    } catch {
        res.status(500).json({ error: 'Error cargando usuarios' });
    }
});

app.delete('/api/admin/users/:id', auth, adminAuth, async (req, res) => {
    try {
        await User.destroy({ where: { id: req.params.id } });
        res.json({ msg: 'Usuario eliminado' });
    } catch {
        res.status(500).json({ error: 'Error eliminando usuario' });
    }
});

/* --- BOOTSTRAP --- */
sequelize.sync({ alter: true }).then(async () => {
    console.log('Base de datos SQLite sincronizada');
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
        const defaultAdmin = process.env.ADMIN_USERNAME || 'admin';
        const defaultPass = process.env.ADMIN_PASSWORD || 'admin';
        await User.create({ username: defaultAdmin, password: encrypt(defaultPass), role: 'admin' });
        console.log(`Admin por defecto habilitado. User: ${defaultAdmin}`);
    }
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
}).catch(e => console.error(e));
