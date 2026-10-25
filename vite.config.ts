import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Sends /api/* and /oauth/callback (MAL's redirect) to api/router.ts inside the Vite dev server, the
 * same single function vercel.json rewrites to, so local dev needs neither the Vercel CLI nor a login.
 */
function devApi(root: string): Plugin {
  return {
    name: 'anidle-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api/') && url.pathname !== '/oauth/callback') return next();

        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };
        try {
          const mod = await server.ssrLoadModule(path.join(root, 'api/router.ts'));
          const method = req.method ?? 'GET';
          const handler = mod[method] as ((request: Request) => Promise<Response>) | undefined;
          if (!handler) return send(405, { error: `${method} not allowed` });

          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
            else if (value != null) headers.set(key, value);
          }
          const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req));
          const response = await handler(new Request(url, { method, headers, body }));

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== 'set-cookie') res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          console.error(err);
          send(500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose .env to the API handlers (process.env), like Vercel does with project env vars.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[key] ??= value;
  return {
    plugins: [react(), devApi(process.cwd())],
  };
});
