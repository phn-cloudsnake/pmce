/**
 * IPC handlers for app installation.
 *
 * Provides the main-process side of the install bridge:
 * - Start/stop the local market server
 * - Open/close TCP socket connections to the server
 * - Forward data between renderer and TCP sockets
 *
 * The renderer (via USB) proxies raw TLS data from the camera through
 * these sockets to the local market server.
 */

import { ipcMain, type WebContents } from 'electron';
import net from 'net';
import { startMarketServer, type MarketServerInstance } from './market-server';

/** Active market server instance */
let activeServer: MarketServerInstance | null = null;

/** Active TCP socket connections (connectionId -> socket) */
const activeSockets = new Map<number, net.Socket>();

/**
 * Register all install-related IPC handlers.
 * Call this once during app initialization.
 */
export function registerInstallIpc(): void {
  // Start the local market server with SPK data
  ipcMain.handle('pmca:start-server', async (_event, spkData: number[]) => {
    // Close any existing server
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }

    const spkUint8 = new Uint8Array(spkData);
    activeServer = await startMarketServer({ spkData: spkUint8 });

    return { port: activeServer.port, url: activeServer.url };
  });

  // Stop the market server
  ipcMain.handle('pmca:stop-server', async () => {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }
    // Close all open sockets
    for (const [id, socket] of activeSockets) {
      socket.destroy();
      activeSockets.delete(id);
    }
  });

  // Open a TCP connection to the local server
  ipcMain.handle(
    'pmca:socket-connect',
    async (event, connectionId: number, _host: string, port: number) => {
      return new Promise<void>((resolve, reject) => {
        // Connect to 127.0.0.1 regardless of host (matching Python behavior)
        const socket = net.connect({ host: '127.0.0.1', port }, () => {
          resolve();
        });

        socket.on('error', (err) => {
          activeSockets.delete(connectionId);
          reject(err);
        });

        // Forward data from server back to renderer
        socket.on('data', (data: Buffer) => {
          const sender = event.sender as WebContents;
          if (!sender.isDestroyed()) {
            sender.send('pmca:socket-data', connectionId, Array.from(data));
          }
        });

        // Notify renderer when socket closes
        socket.on('close', () => {
          activeSockets.delete(connectionId);
          const sender = event.sender as WebContents;
          if (!sender.isDestroyed()) {
            sender.send('pmca:socket-end', connectionId);
          }
        });

        activeSockets.set(connectionId, socket);
      });
    },
  );

  // Send data through a TCP socket (camera -> server)
  ipcMain.handle('pmca:socket-send', async (_event, connectionId: number, data: number[]) => {
    const socket = activeSockets.get(connectionId);
    if (socket && !socket.destroyed) {
      socket.write(Buffer.from(data));
    }
  });

  // Close a TCP socket
  ipcMain.handle('pmca:socket-close', async (_event, connectionId: number) => {
    const socket = activeSockets.get(connectionId);
    if (socket) {
      socket.destroy();
      activeSockets.delete(connectionId);
    }
  });
}
