// Optional local preview: node prototype/serve.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/simulator.js': ['simulator.js', 'text/javascript; charset=utf-8'] };
files['/model.js'] = ['model.js', 'text/javascript; charset=utf-8'];
for (const name of ['machine-skin','slab-surface','machine-view','top-down-motion','playback','motor-monitor','plan-panel','file-actions']) files[`/ui/${name}.js`] = [`ui/${name}.js`, 'text/javascript; charset=utf-8'];
for (const name of ['tokens','layout','controls']) files[`/ui/${name}.css`] = [`ui/${name}.css`, 'text/css; charset=utf-8'];
const server = http.createServer((req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, file[0])).pipe(res);
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`RISE simulator: http://127.0.0.1:${port}`));
