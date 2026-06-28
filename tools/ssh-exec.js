'use strict';

/**
 * Execute a command on the remote NAS via SSH (password auth).
 * Usage: node tools/ssh-exec.js <command>
 */

const { Client } = require('ssh2');
const { loadNasSshConfig } = require('./nas-ssh-config');
const conn = new Client();

const cmd = process.argv.slice(2).join(' ');
if (!cmd) {
  console.error('Usage: node tools/ssh-exec.js <command>');
  process.exit(1);
}

conn.on('ready', () => {
  conn.exec(cmd, { pty: true }, (err, stream) => {
    if (err) throw err;
    let out = '';
    let errOut = '';
    stream.on('close', (code) => {
      conn.end();
      process.stdout.write(out);
      if (errOut) process.stderr.write(errOut);
      process.exit(code);
    });
    stream.on('data', (d) => { out += d.toString(); });
    stream.stderr.on('data', (d) => { errOut += d.toString(); });
  });
});

conn.on('error', (err) => {
  console.error('SSH error:', err.message);
  process.exit(1);
});

conn.connect(loadNasSshConfig({ readyTimeout: 10000 }));
