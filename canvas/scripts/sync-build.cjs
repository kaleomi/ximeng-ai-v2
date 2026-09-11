const fs = require('node:fs');
const path = require('node:path');
const canvas = path.resolve(__dirname, '..');
const source = path.join(canvas, 'dist');
const destination = path.resolve(canvas, '../public/canvas');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Canvas build is missing index.html');
if (destination !== path.join(path.dirname(canvas), 'public', 'canvas')) throw new Error('Unexpected canvas output path');
fs.mkdirSync(destination, { recursive: true });
// Keep previous hashed assets so an already-open editor can still load its bundle.
fs.cpSync(source, destination, { recursive: true });
console.log('Canvas build synchronized to public/canvas');
