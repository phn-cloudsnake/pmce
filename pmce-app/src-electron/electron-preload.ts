/**
 * Electron preload script.
 *
 * This file runs in the renderer process before the page loads.
 * It has access to both DOM APIs and a limited set of Node.js APIs.
 *
 * WebUSB is natively available in Electron's Chromium renderer,
 * so no bridge is needed for USB communication.
 *
 * Exposes the install proxy API for the SSL proxy between camera and
 * local market server.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Install proxy API exposed to the renderer via window.pmcaInstall.
 *
 * This bridges the gap between the renderer (which handles USB communication
 * with the camera) and the main process (which runs the local TLS server and
 * manages TCP sockets).
 */
contextBridge.exposeInMainWorld('pmcaInstall', {
  /**
   * Start the local market server with the given SPK data.
   * @param spkData - Raw SPK file data as a number array.
   * @returns The server port and URL.
   */
  startServer: (spkData: number[]): Promise<{ port: number; url: string }> => {
    return ipcRenderer.invoke('pmca:start-server', spkData);
  },

  /**
   * Stop the local market server and close all sockets.
   */
  stopServer: (): Promise<void> => {
    return ipcRenderer.invoke('pmca:stop-server');
  },

  /**
   * Open a TCP connection to the local server for SSL proxying.
   * @param connectionId - The camera's socket file descriptor / connection ID.
   * @param host - The host the camera wants to connect to (ignored, always connects to 127.0.0.1).
   * @param port - The port to connect to.
   */
  socketConnect: (connectionId: number, host: string, port: number): Promise<void> => {
    return ipcRenderer.invoke('pmca:socket-connect', connectionId, host, port);
  },

  /**
   * Send data through an open TCP socket (camera -> server).
   * @param connectionId - The connection ID.
   * @param data - Raw bytes as a number array.
   */
  socketSend: (connectionId: number, data: number[]): Promise<void> => {
    return ipcRenderer.invoke('pmca:socket-send', connectionId, data);
  },

  /**
   * Close a TCP socket.
   * @param connectionId - The connection ID.
   */
  socketClose: (connectionId: number): Promise<void> => {
    return ipcRenderer.invoke('pmca:socket-close', connectionId);
  },

  /**
   * Register a callback for data received from the server (server -> camera).
   * @param callback - Called with (connectionId, data) when data arrives.
   * @returns A function to unregister the listener.
   */
  onSocketData: (callback: (connectionId: number, data: number[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, connectionId: number, data: number[]) => {
      callback(connectionId, data);
    };
    ipcRenderer.on('pmca:socket-data', handler);
    return () => {
      ipcRenderer.removeListener('pmca:socket-data', handler);
    };
  },

  /**
   * Register a callback for when a socket closes.
   * @param callback - Called with (connectionId) when the socket closes.
   * @returns A function to unregister the listener.
   */
  onSocketEnd: (callback: (connectionId: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, connectionId: number) => {
      callback(connectionId);
    };
    ipcRenderer.on('pmca:socket-end', handler);
    return () => {
      ipcRenderer.removeListener('pmca:socket-end', handler);
    };
  },
});
