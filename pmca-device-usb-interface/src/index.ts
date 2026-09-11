/**
 * PMCA TypeScript - Sony camera USB protocol library
 *
 * This library provides a TypeScript implementation of the Sony PMCA
 * reverse-engineering tool's MTP/SCSI command layer, targeting WebUSB
 * for browser-based camera communication.
 *
 * Scope: camera info retrieval and app installation.
 */

export { PmcaDevice } from './pmca-device.js';
export type {
  CameraInfo,
  InstallResult,
  ProgressCallback,
  ProgressEvent,
  SslProxy,
} from './types.js';
export * from './constants.js';
export * from './errors.js';

// Protocol internals (for custom transport implementations)
export { MtpDriver } from './protocol/mtp-driver.js';
export { SonyExtCmdProtocol } from './protocol/sony-ext-cmd-protocol.js';
export { SonyUpdaterProtocol, formatVersion } from './protocol/sony-updater-protocol.js';
export type { UpdaterVersions } from './protocol/sony-updater-protocol.js';
export { SonyAppInstallProtocol } from './protocol/sony-app-install-protocol.js';
export type { AppInstallMessage } from './protocol/sony-app-install-protocol.js';

// Transport interface (implement for custom USB backends)
export type { UsbTransport } from './transport/usb-transport.js';
export { WebUsbBackend } from './transport/web-usb-backend.js';
export type { WebUsbBackendOptions } from './transport/web-usb-backend.js';
