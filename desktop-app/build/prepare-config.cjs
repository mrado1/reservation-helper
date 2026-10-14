const fs = require('node:fs');
const path = require('node:path');
const { publicConfig } = require('../lib/public-config');
module.exports = async () => {
  const root = path.resolve(__dirname, '..');
  const local = path.join(root, 'config.js');
  const config = fs.existsSync(local) ? require(local) : {};
  fs.writeFileSync(path.join(root, 'config.public.json'), JSON.stringify(publicConfig(config), null, 2) + '\n');
};
