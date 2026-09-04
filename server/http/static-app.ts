import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function mountStaticApp(app: Express) {
  const directory = resolve('dist');
  if (!existsSync(directory)) return;
  app.use(express.static(directory));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
    response.sendFile(resolve(directory, 'index.html'));
  });
}
