/**
 * Core type definitions for the PMCA TypeScript library.
 *
 * All shared interfaces used across the protocol layers, command handlers,
 * and the high-level PmcaDevice API.
 */

/** Camera identification and metadata returned by the info() command. */
export interface CameraInfo {
  modelName: string;
  modelCode: string;
  serialNumber: string;
  plistData: Uint8Array;
  firmwareVersion?: string;
  lensModel?: string;
  lensFirmwareVersion?: string;
  gpsDataRange?: { start: Date; end: Date };
}

/** Result of an app installation operation. */
export interface InstallResult {
  code: number;
  message: string;
}

/** Progress event emitted during long-running operations. */
export interface ProgressEvent {
  operation: string;
  currentBytes: number;
  totalBytes: number;
  percent: number;
}

/** Callback type for receiving progress events. */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * SSL proxy interface for app installation.
 *
 * The camera sends raw TLS data through USB during app installation.
 * This interface allows the host environment to proxy that data to a local
 * TLS server. The USB library calls these methods; the consumer implements them.
 *
 * In Electron, this is backed by IPC to the main process which manages TCP sockets.
 * In a Node.js CLI context, this could directly use net.Socket.
 */
export interface SslProxy {
  /**
   * Called when the server should be started with the given SPK data.
   * @param spkData - The SPK-wrapped APK to serve.
   * @returns The port the server is listening on.
   */
  startServer(spkData: Uint8Array): Promise<{ port: number; url: string }>;

  /**
   * Open a TCP connection to the local server.
   * @param connectionId - The camera's connection identifier.
   * @param host - The hostname (typically ignored — always connect to 127.0.0.1).
   * @param port - The port to connect to.
   */
  connect(connectionId: number, host: string, port: number): Promise<void>;

  /**
   * Send data from the camera to the server through the TCP connection.
   * @param connectionId - The connection identifier.
   * @param data - Raw bytes from the camera (TLS-encrypted).
   */
  send(connectionId: number, data: Uint8Array): Promise<void>;

  /**
   * Close a TCP connection.
   * @param connectionId - The connection identifier.
   */
  close(connectionId: number): Promise<void>;

  /**
   * Register a callback for data received from the server.
   * @param callback - Called with (connectionId, data) when the server sends data.
   * @returns A function to unregister the listener.
   */
  onData(callback: (connectionId: number, data: Uint8Array) => void): () => void;

  /**
   * Shut down the server when installation is complete.
   */
  stopServer(): Promise<void>;
}
