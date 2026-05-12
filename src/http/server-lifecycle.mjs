const serverConnectionTrackerSymbol = Symbol('serverConnectionTracker');

export function trackServerConnections(server) {
  if (server[serverConnectionTrackerSymbol]) {
    return server[serverConnectionTrackerSymbol];
  }

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  const tracker = {
    destroyAll() {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
  };

  server[serverConnectionTrackerSymbol] = tracker;
  return tracker;
}

export function listenServer(server, host, port) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanup() {
      server.off('error', handleError);
      server.off('listening', handleListening);
    }

    function handleError(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }

    function handleListening() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, host);
  });
}

export function closeServer(server, options = {}) {
  const forceAfterMs = Number.isFinite(options.forceAfterMs) ? Math.max(0, options.forceAfterMs) : null;
  const tracker = trackServerConnections(server);

  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    let settled = false;
    let forceTimer = null;

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }

    try {
      server.close((error) => {
        finish(error);
      });
      server.closeIdleConnections?.();
    } catch (error) {
      finish(error);
      return;
    }

    if (forceAfterMs !== null) {
      forceTimer = setTimeout(() => {
        try {
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
            return;
          }
          tracker.destroyAll();
        } catch {
          // Ignore force-close failures and let the original close callback settle the promise.
        }
      }, forceAfterMs);
      forceTimer.unref?.();
    }
  });
}
