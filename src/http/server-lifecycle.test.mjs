import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { closeServer, listenServer, trackServerConnections } from './server-lifecycle.mjs';

test('listenServer binds an HTTP server and closeServer shuts it down', async () => {
  const server = http.createServer();
  trackServerConnections(server);

  await listenServer(server, '127.0.0.1', 0);

  const address = server.address();
  assert.equal(typeof address?.port, 'number');
  assert.equal(server.listening, true);

  await closeServer(server);
  assert.equal(server.listening, false);
});

test('listenServer rejects with EADDRINUSE when the port is already bound', async () => {
  const firstServer = http.createServer();
  const secondServer = http.createServer();
  trackServerConnections(firstServer);
  trackServerConnections(secondServer);

  await listenServer(firstServer, '127.0.0.1', 0);
  const address = firstServer.address();

  await assert.rejects(
    listenServer(secondServer, '127.0.0.1', address.port),
    { code: 'EADDRINUSE' },
  );

  await closeServer(secondServer);
  await closeServer(firstServer);
});

test('closeServer force-closes open connections after a short grace period', async () => {
  const server = http.createServer();
  trackServerConnections(server);

  await listenServer(server, '127.0.0.1', 0);
  const address = server.address();
  const socket = net.createConnection({ host: '127.0.0.1', port: address.port });
  await once(socket, 'connect');

  const startedAt = Date.now();
  await closeServer(server, { forceAfterMs: 25 });
  const elapsedMs = Date.now() - startedAt;

  await once(socket, 'close');
  assert.equal(server.listening, false);
  assert.equal(socket.destroyed, true);
  assert.ok(elapsedMs < 2000);
});
