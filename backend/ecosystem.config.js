const fs = require('fs');

function parseEnv(filePath) {
  try {
    return Object.fromEntries(
      fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
          const idx = line.indexOf('=');
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          return [key, val];
        })
    );
  } catch { return {}; }
}

const envVars = parseEnv(__dirname + '/.env');

module.exports = {
  apps: [{
    name: 'be-api',
    script: 'dist/main.js',
    cwd: __dirname,
    node_args: '--max-old-space-size=384',
    env: { NODE_ENV: 'production', ...envVars },
    restart_delay: 3000,
    max_restarts: 10,
  }]
};

