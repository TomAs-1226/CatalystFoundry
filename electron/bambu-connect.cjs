/** Official Bambu Connect file-import protocol. Never accepts a renderer URL. */
const path = require('node:path');
function connectUrl(file, name) {
  if (!path.isAbsolute(file) || !/\.gcode\.3mf$/i.test(file) || /[\r\n\0]/.test(file)) throw new Error('Connect requires an absolute native sliced .gcode.3mf file.');
  if (typeof name !== 'string' || !name.trim() || name.length > 240 || /[\r\n\0]/.test(name)) throw new Error('Invalid Connect display name.');
  return `bambu-connect://import-file?path=${encodeURIComponent(file)}&name=${encodeURIComponent(name)}&version=1.0.0`;
}
module.exports = { connectUrl };
