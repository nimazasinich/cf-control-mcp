import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './migrations',   // was './drizzle'; wrangler d1 migrations apply looks here by default
  dialect: 'sqlite',
  driver: 'd1-http',
});
