const path = require('path');
const scheduleData = require(path.join(__dirname, '../../schedule.json'));

async function scrapeAvailableClasses() {
    return scheduleData;
}

module.exports = { scrapeAvailableClasses };
