// Registers every API route as an HTTP-triggered Azure Function (Node.js v4 programming model).
// Azure Static Web Apps puts the signed-in user in the x-ms-client-principal header.
const { app } = require('@azure/functions');
const routes = require('../lib/routes');
const { run, parsePrincipal } = require('../lib/handlers');

routes.forEach(({ fn, method, route }) => {
  app.http(`${fn}_${method}_${route.replace(/[^a-z]/gi, '_')}`, {
    methods: [method],
    authLevel: 'anonymous',
    route,
    handler: async (request) => {
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          body = (await request.json()) || {};
        } catch {
          body = {};
        }
      }
      const result = await run(fn, {
        method,
        params: request.params || {},
        query: Object.fromEntries(request.query.entries()),
        body: typeof body === 'object' && body !== null ? body : {},
        principal: parsePrincipal(request.headers.get('x-ms-client-principal')),
      });
      return { status: result.status, jsonBody: result.body, headers: { 'Cache-Control': 'no-store' } };
    },
  });
});
