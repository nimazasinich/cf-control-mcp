import { serve } from '@hono/node-server';
import app, { type AppBindings } from './src/server/app';
import { getNodeDb, initializeDb } from './src/server/db/node';
import { startHealthCheck } from './src/server/health';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';
import fs from 'fs';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

async function start() {
  await initializeDb();
  const db = getNodeDb();
  startHealthCheck(db, 15000); // Poll every 15s for the demo

  // Serve static files from React build if running in production
  const distPath = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distPath)) {
    console.log('Serving static files from /dist');
    app.use('/assets/*', serveStatic({ root: './dist' }));
    app.use('/*', serveStatic({ root: './dist', path: 'index.html' }));
  }

  const bindings: AppBindings = { db };

  serve({
    fetch: (request) => app.fetch(request, bindings),
    port: PORT,
  }, (info) => {
    console.log(`Server listening on port ${info.port}`);
  });
}

start();
