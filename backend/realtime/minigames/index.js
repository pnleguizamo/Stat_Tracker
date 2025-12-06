const fs = require('fs');
const path = require('path');

const modules = {};

function loadAll() {
  const dir = __dirname;
  for (const filename of fs.readdirSync(dir)) {
    if (!filename.endsWith('.js') || filename === 'index.js') continue;
    const key = path.basename(filename, '.js');
    try {
      modules[key] = require(path.join(dir, filename));
    } catch (err) {
      // don't crash the whole server if one module fails to load
      console.error('Failed to load minigame module', filename, err);
    }
  }
}

function registerAll(io, socket, deps = {}) {
  for (const [name, mod] of Object.entries(modules)) {
    if (mod && typeof mod.register === 'function') {
      try {
        mod.register(io, socket, deps);
      } catch (err) {
        console.error('Error registering minigame', name, err);
      }
    }
  }
}

loadAll();

module.exports = { registerAll, modules };
