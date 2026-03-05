const { DataTypes } = require('sequelize');
const { randomUUID } = require('crypto');
const sequelize = require('../config/database');

const Schedule = sequelize.define('Schedule', {
    id: {
        type: DataTypes.STRING(36),
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    className: {
        type: DataTypes.STRING,
        allowNull: false
    },
    dayOfWeek: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    time: {
        type: DataTypes.STRING,
        allowNull: false
    },
    autoScrape: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'schedules',
    hooks: {
        beforeCreate: (schedule) => {
            if (!schedule.id) schedule.id = randomUUID();
        }
    }
});

module.exports = Schedule;
