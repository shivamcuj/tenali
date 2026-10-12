// Proves the login route stops answering real attempts after the limit, so a
// password can't be guessed as fast as the network allows (no other throttle
// exists anywhere else in this app). Plain node:assert, spawns the real server
// (index.js always calls app.listen() on require, so it can't be imported
// in-process — same pattern as tests/test_hints.js).
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const PORT = 4501;

function post(path_) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'nobody', password: 'wrong' });
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: path_, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

console.log('Starting Tenali root-app test server on port', PORT);
const child = spawn('node', [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT, MONGO_URI: 'mongodb://127.0.0.1:1/none' }, // unreachable on purpose: login fails fast either way
});

let started = false;
const timeout = setTimeout(() => { if (!started) { console.error('FAIL: server did not start in time'); child.kill(); process.exitCode = 1; } }, 15000);

child.stdout.on('data', async (data) => {
  if (started) return;
  if (!data.toString().includes('Tenali app running')) return;
  started = true;
  clearTimeout(timeout);
  try {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await post('/api/auth/login')).status);
    assert.ok(statuses.includes(429), `expected a 429 among the first 12 attempts, got: ${statuses.join(',')}`);
    const firstLimited = statuses.indexOf(429);
    assert.ok(firstLimited <= 10, `limit should bite at or before attempt 10, bit at ${firstLimited + 1}`);
    console.log('PASS: login is rate limited —', statuses.join(','));
    process.exitCode = 0;
  } catch (err) {
    console.error('FAIL:', err.message);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
});
child.stderr.on('data', (d) => console.error('[server]', d.toString().trim()));
