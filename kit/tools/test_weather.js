'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appDir = path.join(root, 'apps', 'weather_bmw');
const manifestPath = path.join(appDir, 'app.json');
const mainPath = path.join(appDir, 'main.js');

function fail(msg) {
    console.error('ERROR:', msg);
    process.exit(1);
}

function ok(msg) {
    console.log('OK:', msg);
}

if (!fs.existsSync(appDir)) {
    fail('apps/weather_bmw does not exist');
}
ok('Weather app directory exists');

if (!fs.existsSync(manifestPath)) {
    fail('apps/weather_bmw/app.json does not exist');
}
ok('app.json exists');

if (!fs.existsSync(mainPath)) {
    fail('apps/weather_bmw/main.js does not exist');
}
ok('main.js exists');

let manifest;

try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
    fail('app.json is not valid JSON: ' + e.message);
}

ok('app.json is valid JSON');

if (manifest.id !== 'weather_bmw') {
    fail('Manifest id must be weather_bmw');
}
ok('Manifest id is weather_bmw');

if (manifest.mguInternet !== true) {
    fail('mguInternet must be true');
}
ok('mguInternet is enabled');

if (!Array.isArray(manifest.mguHmi) || manifest.mguHmi.indexOf('ID7') === -1) {
    fail('mguHmi must contain ID7');
}
ok('ID7 compatibility declared');

if (!manifest.startWidget) {
    fail('startWidget is missing');
}
ok('startWidget exists');

if (manifest.startWidget.layout !== 'LT_Table_OnlineApps_DriveRecorderWidget') {
    fail('Unexpected widget layout');
}
ok('Widget layout is correct');

const expectedCells = [
    'Title',
    'TextRecordings',
    'TextCam',
    'ProgressbarVisible',
    'Progress',
    'TimeElapsed',
    'TimeRemaining'
];

expectedCells.forEach(function(cell) {
    if (
        !manifest.startWidget.cells ||
        manifest.startWidget.cells[cell] === undefined
    ) {
        fail('Missing widget cell: ' + cell);
    }
});

ok('Small-widget native cells are present');

const mainCode = fs.readFileSync(mainPath, 'utf8');

if (mainCode.indexOf('api.open-meteo.com') === -1) {
    fail('Open-Meteo endpoint not found in main.js');
}
ok('Open-Meteo endpoint found');

if (mainCode.indexOf('ctx.widget.set') === -1) {
    fail('Small widget native cell update logic not found');
}
ok('Small widget cell update logic found');

if (mainCode.indexOf('ctx.widget.loop') === -1) {
    fail('Widget render loop not found');
}
ok('Widget loop found');

if (mainCode.indexOf('https.get') === -1) {
    fail('HTTPS request logic not found');
}
ok('HTTPS request logic found');

console.log('');
console.log('Weather app validation completed successfully.');
process.exit(0);