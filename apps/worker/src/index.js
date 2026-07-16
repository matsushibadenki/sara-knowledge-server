// /apps/worker/src/index.js
console.log(JSON.stringify({
  level: 'info',
  service: 'worker',
  message: 'SARA Knowledge worker started; job handlers will be added in Phase 5.',
}));

setInterval(() => {}, 60_000);
