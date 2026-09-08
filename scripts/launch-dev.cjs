// Temp launcher (verification only): spawns the dev server, forwards its output
// to %USERPROFILE%\vaani-server.log, and keeps the parent alive so the server
// lives for the session. Run as a harness background task.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const logPath = path.join(os.homedir(), 'vaani-server.log');
const outFd = fs.openSync(logPath, 'a');

const child = spawn('npm.cmd', ['run', 'dev:server'], {
  cwd: process.cwd(),
  shell: false,
  stdio: ['ignore', outFd, outFd],
});
console.log(`spawned dev server (pid ${child.pid}); log → ${logPath}`);
child.on('exit', (code) => {
  console.log(`dev server exited (code ${code})`);
  process.exit(0);
});
// Keep the parent alive so the harness holds the task while the server runs.
setInterval(() => {}, 1 << 30).unref();