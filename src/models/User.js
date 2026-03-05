const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    role: {
        type: DataTypes.ENUM('admin', 'user'),
        defaultValue: 'user',
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: { // AES-encrypted — used for login AND scraping
        type: DataTypes.STRING,
        allowNull: false
    },
    autoScrape: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    lastExecutionStatus: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastExecutionTime: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = User;
