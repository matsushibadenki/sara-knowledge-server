// /apps/api/src/index.js
import app from './app.js';
import { validateAuthConfig } from './auth/tokens.js';

const port = Number(process.env.API_PORT || 4000);
validateAuthConfig();

console.log(JSON.stringify({
  level: 'info',
  service: 'api',
  port,
  message: 'SARA Knowledge API started',
}));

export default {
  hostname: '0.0.0.0',
  port,
  fetch: app.fetch,
};
