/**
 * PmcaDevice - High-level async API for Sony camera communication via WebUSB.
 *
 * Encapsulates the full protocol stack from USB transport through MTP/ExtCmd
 * to high-level camera commands. Instantiate via the static `connect()` method
 * or by passing a USBDevice handle to the constructor.
 */

import { SONY_VENDOR_ID, GPS_EPOCH, XPD_CIC_KEY } from './constants.js';
import { DeviceError, InvalidCommandError, TimeoutError } from './errors.js';
import { SpkCodec } from './codecs/spk-codec.js';
import { WebUsbBackend } from './transport/web-usb-backend.js';
import { MtpDriver } from './protocol/mtp-driver.js';
import { SonyExtCmdProtocol } from './protocol/sony-ext-cmd-protocol.js';
import { SonyUpdaterProtocol, formatVersion } from './protocol/sony-updater-protocol.js';
import { SonyAppInstallProtocol } from './protocol/sony-app-install-protocol.js';
import type { AppInstallMessage } from './protocol/sony-app-install-protocol.js';
import { StructUtil } from './utils/struct-util.js';
import type {
  CameraInfo,
  InstallResult,
  ProgressCallback,
  SslProxy,
} from './types.js';

/**
 * Struct for the GPS init request: firstDate, lastDate, one, crc32, size (all int32 LE).
 */
const InitGpsRequestStruct = new StructUtil([
  { name: 'firstDate', type: 'int32' },
  { name: 'lastDate', type: 'int32' },
  { name: 'one', type: 'int32' },
  { name: 'crc32', type: 'int32' },
  { name: 'size', type: 'int32' },
]);

/**
 * Struct for the GPS init response: status (int16), firstDate (int32), lastDate (int32).
 */
const InitGpsResponseStruct = new StructUtil([
  { name: 'status', type: 'int16' },
  { name: 'firstDate', type: 'int32' },
  { name: 'lastDate', type: 'int32' },
]);

/**
 * Struct for mounted lens info: type (int32), versionMinor (int8), versionMajor (int8),
 * model (4 bytes), region (4 bytes).
 */
const MountedLensInfoStruct = new StructUtil([
  { name: 'type', type: 'int32' },
  { name: 'versionMinor', type: 'int8' },
  { name: 'versionMajor', type: 'int8' },
  { name: 'model', type: 'str', length: 4 },
  { name: 'region', type: 'str', length: 4 },
]);

/**
 * Main entry point for Sony camera communication via WebUSB.
 *
 * Provides async methods for the two supported camera operations:
 * info retrieval and app installation.
 */
export class PmcaDevice {
  private backend: WebUsbBackend;
  private driver: MtpDriver;
  private extCmd: SonyExtCmdProtocol;
  private updater: SonyUpdaterProtocol;
  private disconnected = false;

  /**
   * Connect to a Sony camera via the WebUSB device chooser.
   *
   * Prompts the user to select a Sony USB device, opens it,
   * and returns a ready-to-use PmcaDevice instance.
   *
   * @throws {DeviceError} If the user cancels device selection or the device cannot be opened.
   */
  static async connect(): Promise<PmcaDevice> {
    let backend: WebUsbBackend;
    try {
      backend = await WebUsbBackend.requestDevice();
    } catch (error) {
      throw new DeviceError(
        `Failed to connect to camera: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      await backend.open();
    } catch (error) {
      throw new DeviceError(
        `Failed to open camera connection: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { vendorId } = backend.getDeviceIds();
    if (vendorId !== SONY_VENDOR_ID) {
      await backend.close();
      throw new DeviceError(
        `Device is not a Sony camera (vendor ID 0x${vendorId.toString(16)}, expected 0x${SONY_VENDOR_ID.toString(16)})`,
      );
    }

    const device = new PmcaDevice(backend);
    await device.driver.openSession();
    return device;
  }

  /**
   * Construct a PmcaDevice from an already-opened WebUsbBackend.
   *
   * Validates the vendor ID and instantiates the protocol stack:
   * WebUsbBackend → MtpDriver → SonyExtCmdProtocol / SonyUpdaterProtocol.
   *
   * @param backend - An opened WebUsbBackend instance connected to a Sony camera.
   * @throws {DeviceError} If the device vendor ID is not Sony (0x054c).
   */
  constructor(backend: WebUsbBackend) {
    const { vendorId } = backend.getDeviceIds();
    if (vendorId !== SONY_VENDOR_ID) {
      throw new DeviceError(
        `Device is not a Sony camera (vendor ID 0x${vendorId.toString(16)}, expected 0x${SONY_VENDOR_ID.toString(16)})`,
      );
    }

    this.backend = backend;
    this.driver = new MtpDriver(backend);
    this.extCmd = new SonyExtCmdProtocol(this.driver);
    this.updater = new SonyUpdaterProtocol(this.extCmd);
  }

  /**
   * Disconnect from the camera, releasing the USB interface.
   *
   * This method is idempotent — calling it multiple times is safe.
   * After disconnecting, all other methods will throw.
   */
  async disconnect(): Promise<void> {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    try {
      await this.driver.closeSession();
    } catch {
      // Swallow errors during session close
    }

    try {
      await this.backend.close();
    } catch {
      // Swallow errors during disconnect — device may already be gone
    }
  }

  /**
   * Ensure the device is still connected before executing a command.
   * @throws {DeviceError} If the device has been disconnected.
   */
  private ensureConnected(): void {
    if (this.disconnected) {
      throw new DeviceError('Device has been disconnected');
    }
  }

  // ===========================================================================
  // Command Methods
  // ===========================================================================

  /** Retrieve camera identification and metadata. */
  async info(): Promise<CameraInfo> {
    this.ensureConnected();

    // 1. Query model info via ExtCmd (group 1, command 1)
    const modelData = await this.extCmd.sendCommand(1, 1);
    const { modelName, modelCode, serialNumber, plistData } =
      this.parseModelInfo(modelData);

    // 2. Query firmware version via updater protocol
    let firmwareVersion: string | undefined;
    try {
      await this.updater.init();
      const versions = await this.updater.queryVersion();
      firmwareVersion = versions.oldVersion;
    } catch {
      // Updater protocol not supported on this camera — skip firmware version
    }

    const result: CameraInfo = {
      modelName,
      modelCode,
      serialNumber,
      plistData,
      firmwareVersion,
    };

    // 3. Try lens info (group 6, command 2) — omit on InvalidCommandError
    try {
      const lensData = await this.extCmd.sendCommand(6, 2);
      const lensInfo = MountedLensInfoStruct.unpack(lensData);
      if (lensInfo !== null) {
        // Parse 4-byte model field into a 32-bit value using the Python byte order:
        // model[0:2] + model[3:4] + model[2:3] → big-endian uint32
        const modelBytes = lensInfo['model'] as Uint8Array;
        const lensModelValue =
          (modelBytes[0] << 24) |
          (modelBytes[1] << 16) |
          (modelBytes[3] << 8) |
          modelBytes[2];
        if (lensModelValue !== 0) {
          result.lensModel = '0x' + lensModelValue.toString(16);
          const lensMajor = lensInfo['versionMajor'] as number;
          const lensMinor = lensInfo['versionMinor'] as number;
          result.lensFirmwareVersion = formatVersion(lensMajor, lensMinor);
        }
      }
    } catch (err) {
      if (!(err instanceof InvalidCommandError)) {
        throw err;
      }
      // Gracefully omit lens info if command not supported
    }

    // 4. Try GPS data (group 3, command 1) — omit on InvalidCommandError
    try {
      const gpsRequestPayload = InitGpsRequestStruct.pack({
        firstDate: 0,
        lastDate: 0,
        one: 1,
        crc32: 0,
        size: 0x43800,
      });
      const gpsData = await this.extCmd.sendCommand(3, 1, gpsRequestPayload, 0x10000, 0x200);
      const gpsInfo = InitGpsResponseStruct.unpack(gpsData);
      if (gpsInfo !== null) {
        const firstDate = gpsInfo['firstDate'] as number;
        const lastDate = gpsInfo['lastDate'] as number;
        result.gpsDataRange = {
          start: this.convertGpsTimestamp(firstDate),
          end: this.convertGpsTimestamp(lastDate, 6),
        };
      }
    } catch (err) {
      if (!(err instanceof InvalidCommandError)) {
        throw err;
      }
      // Gracefully omit GPS data if command not supported
    }

    return result;
  }

  /**
   * Parse the model info response from ExtCmd (group 1, command 1).
   *
   * Binary format:
   * - 4 bytes: plistSize (uint32 LE)
   * - plistSize bytes: plistData
   * - 4 bytes: unknown/padding
   * - 1 byte: modelNameSize (uint8)
   * - modelNameSize bytes: model name (latin1)
   * - 5 bytes: model code (hex-encoded)
   * - 4 bytes: serial number (hex-encoded)
   */
  private parseModelInfo(data: Uint8Array): {
    modelName: string;
    modelCode: string;
    serialNumber: string;
    plistData: Uint8Array;
  } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // Read plist size (4 bytes LE)
    const plistSize = view.getUint32(offset, true);
    offset += 4;

    // Read plist data
    const plistData = data.slice(offset, offset + plistSize);
    offset += plistSize;

    // Skip 4 bytes (unknown/padding)
    offset += 4;

    // Read model name size (1 byte)
    const modelNameSize = view.getUint8(offset);
    offset += 1;

    // Read model name (latin1 encoding — each byte maps directly to char code)
    const modelNameBytes = data.slice(offset, offset + modelNameSize);
    let modelName = '';
    for (let i = 0; i < modelNameBytes.length; i++) {
      modelName += String.fromCharCode(modelNameBytes[i]);
    }
    offset += modelNameSize;

    // Read model code (5 bytes, hex-encoded)
    const modelCodeBytes = data.slice(offset, offset + 5);
    let modelCode = '';
    for (let i = 0; i < modelCodeBytes.length; i++) {
      modelCode += modelCodeBytes[i].toString(16).padStart(2, '0');
    }
    offset += 5;

    // Read serial number (4 bytes, hex-encoded)
    const serialBytes = data.slice(offset, offset + 4);
    let serialNumber = '';
    for (let i = 0; i < serialBytes.length; i++) {
      serialNumber += serialBytes[i].toString(16).padStart(2, '0');
    }

    return { modelName, modelCode, serialNumber, plistData };
  }

  /**
   * Convert a GPS timestamp (hours since January 6, 1980) to a Date.
   *
   * @param timestamp - Raw timestamp value from the camera (lower 24 bits = hours).
   * @param additionalHours - Extra hours to add (used for end date which adds 6 hours).
   */
  private convertGpsTimestamp(timestamp: number, additionalHours: number = 0): Date {
    const hours = (timestamp & 0xffffff) + additionalHours;
    const ms = hours * 60 * 60 * 1000;
    return new Date(GPS_EPOCH.getTime() + ms);
  }

  /**
   * Install an APK on the camera.
   *
   * Performs the full app installation flow:
   * 1. Switch camera to app install mode via ExtCmd (group 5, command 2)
   * 2. Poll for device reconnection (10 seconds timeout)
   * 3. Execute app install protocol: init → REST start → SSL proxy → await completion
   * 4. Handle progress events and result codes
   *
   * @param options.apkData - Raw APK file data to install.
   * @param options.packageName - Package name to download from app store (alternative to apkData).
   * @param options.onProgress - Callback for progress updates during installation.
   * @param options.sslProxy - SSL proxy implementation for forwarding TLS data to local server.
   * @returns InstallResult with code (0 = success) and message.
   * @throws {InvalidCommandError} If the camera does not support app installation.
   * @throws {TimeoutError} If the camera does not reconnect within 10 seconds.
   * @throws {DeviceError} If the camera returns a non-zero result code.
   */
  async install(options: {
    apkData?: Uint8Array;
    packageName?: string;
    onProgress?: ProgressCallback;
    sslProxy?: SslProxy;
  }): Promise<InstallResult> {
    this.ensureConnected();

    // 1. Switch camera to app install mode via ExtCmd (group 5, command 2)
    await this.extCmd.sendCommand(5, 2, undefined, undefined, 0);

    // 2. Close the current connection — camera is rebooting into app install mode
    try {
      await this.driver.closeSession();
    } catch {
      // Ignore — connection may already be broken
    }
    try {
      await this.backend.close();
    } catch {
      // Ignore — device may have already disconnected
    }

    // 3. Wait briefly for the device to fully disconnect before polling
    await this.delay(2000);

    // 4. Poll for device reconnection in app install mode (20 seconds timeout)
    const appInstallProtocol = await this.pollForAppInstallReconnection();

    // 5. Execute app install protocol
    return this.executeAppInstall(appInstallProtocol, options);
  }

  /**
   * Poll for device reconnection in app install mode.
   *
   * After switching to app install mode, the camera reboots and reappears
   * as a new USB device with app install MTP operation codes (0x9488/0x9489/0x948c/0x948d).
   *
   * In a WebUSB browser context, this uses navigator.usb.getDevices() to detect
   * previously-paired devices that reappear after reboot.
   *
   * @returns SonyAppInstallProtocol instance connected to the reconnected device.
   * @throws {TimeoutError} If the device does not reconnect within 20 seconds.
   */
  private async pollForAppInstallReconnection(): Promise<SonyAppInstallProtocol> {
    const maxAttempts = 40; // 40 × 500ms = 20 seconds
    const intervalMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.delay(intervalMs);

      try {
        // Try to get previously-authorized devices (does not require user gesture)
        const devices = await navigator.usb.getDevices();
        const sonyDevice = devices.find(
          (d) => d.vendorId === SONY_VENDOR_ID && d.opened === false,
        );

        if (!sonyDevice) continue;

        // Create new backend and try to open
        const newBackend = new WebUsbBackend(sonyDevice);
        try {
          await newBackend.open();
        } catch {
          // Device not fully ready yet — continue polling
          continue;
        }

        // Create MTP driver and open session to verify it's in app install mode
        const newDriver = new MtpDriver(newBackend);
        try {
          await newDriver.openSession();
        } catch {
          // Session open failed — device may still be initializing
          try { await newBackend.close(); } catch { /* ignore */ }
          continue;
        }

        // Device opened successfully in app install mode
        return new SonyAppInstallProtocol(newDriver);
      } catch {
        // Device not ready yet, continue polling
      }
    }

    throw new TimeoutError(
      'Camera did not reconnect in app install mode within 20 seconds',
    );
  }

  /**
   * Execute the app installation protocol flow.
   *
   * Sends init, REST start request with XPD data, handles SSL proxy messages
   * in a loop, and awaits the completion message from the camera.
   *
   * @param appInstall - The SonyAppInstallProtocol instance.
   * @param options - Installation options including APK data and progress callback.
   * @returns InstallResult with code and message.
   */
  private async executeAppInstall(
    appInstall: SonyAppInstallProtocol,
    options: {
      apkData?: Uint8Array;
      packageName?: string;
      onProgress?: ProgressCallback;
      sslProxy?: SslProxy;
    },
  ): Promise<InstallResult> {
    // 3a. Send init and receive supported protocols
    await appInstall.sendInit();

    // 3b. Start local market server if proxy is available, get portal URL
    let tcdUrl = 'https://portal.localtest.me/';
    if (options.sslProxy && options.apkData) {
      // Wrap APK in SPK format for the camera
      const spkData = await SpkCodec.apkToSpk(options.apkData);
      const serverInfo = await options.sslProxy.startServer(spkData);
      tcdUrl = serverInfo.url;
    }

    // 3c. Build XPD data payload and send REST start request
    const xpdData = await this.buildXpdData(tcdUrl);
    const startRequest = this.buildRestStartRequest(xpdData);
    const startResponse = await appInstall.sendRequest(startRequest);
    const startResult = this.parseJsonResult(startResponse);

    if (startResult.code !== 0) {
      throw new DeviceError(
        `App install start failed: ${startResult.message} (code ${startResult.code})`,
      );
    }

    // 3c. Set up SSL proxy data listener if available.
    // Server data is collected in a queue and sent to the camera in the main loop
    // to avoid concurrent USB transactions.
    let unsubscribeData: (() => void) | null = null;
    const serverDataQueue: Array<{ connectionId: number; data: Uint8Array }> = [];

    if (options.sslProxy) {
      unsubscribeData = options.sslProxy.onData((connectionId, data) => {
        serverDataQueue.push({ connectionId, data });
      });
    }

    try {
      // 3d. Main message loop: handle SSL proxy and REST messages until completion
      while (true) {
        // First, drain any pending server data back to the camera
        while (serverDataQueue.length > 0) {
          const item = serverDataQueue.shift()!;
          await appInstall.sendSslData(item.connectionId, item.data);
        }

        const message = await appInstall.receiveMessage();
        if (message === null) {
          // No data from camera yet — yield to event loop so IPC callbacks can fire
          await this.delay(10);
          continue;
        }

        console.log('[PMCA] Message received:', message.type);
        const result = await this.handleAppInstallMessage(appInstall, message, options);
        if (result !== null) {
          // Completion received — send end and return result
          await appInstall.sendEnd();
          return result;
        }
      }
    } finally {
      // Clean up listener
      if (unsubscribeData) {
        unsubscribeData();
      }
      // Stop server
      if (options.sslProxy) {
        await options.sslProxy.stopServer().catch(() => { /* ignore */ });
      }
    }
  }

  /**
   * Handle a single app install protocol message.
   *
   * Dispatches based on message type:
   * - sslStart: Opens a TCP connection to the local server via sslProxy
   * - sslData: Forwards TLS data from camera to server via sslProxy
   * - sslEnd: Closes the proxied connection
   * - request: Handles REST request messages (progress/complete)
   *
   * @returns InstallResult if the message indicates completion, null otherwise.
   */
  private async handleAppInstallMessage(
    appInstall: SonyAppInstallProtocol,
    message: AppInstallMessage,
    options: {
      onProgress?: ProgressCallback;
      sslProxy?: SslProxy;
    },
  ): Promise<InstallResult | null> {
    switch (message.type) {
      case 'sslStart':
        if (options.sslProxy) {
          // Open a TCP connection to the local market server
          console.log('[PMCA] sslStart: connecting to', message.host, message.port);
          await options.sslProxy.connect(
            message.connectionId,
            message.host,
            message.port,
          );
          console.log('[PMCA] sslStart: connected');
        } else {
          // No proxy available — notify camera we can't connect
          await appInstall.sendSslEnd(message.connectionId);
        }
        break;

      case 'sslData':
        if (options.sslProxy) {
          // Forward TLS data from camera to the local server
          console.log('[PMCA] sslData: forwarding', message.data.length, 'bytes');
          await options.sslProxy.send(message.connectionId, message.data);
        }
        break;

      case 'sslEnd':
        if (options.sslProxy) {
          // Camera closed the SSL connection
          console.log('[PMCA] sslEnd: connection', message.connectionId, 'closed by camera');
          await options.sslProxy.close(message.connectionId);
        }
        break;

      case 'request': {
        // REST request from camera — parse and handle
        const parsed = this.parseRestRequest(message.data);
        console.log('[PMCA] request URL:', parsed.url, 'method:', parsed.method);
        if (parsed.url === '/task/progress') {
          // Progress update from camera
          console.log('[PMCA] progress body:', new TextDecoder('latin1').decode(parsed.body).slice(0, 200));
          const status = this.parseJsonStatus(parsed.body);
          if (options.onProgress) {
            options.onProgress({
              operation: status.message,
              currentBytes: 0,
              totalBytes: status.totalSize,
              percent: status.percent,
            });
          }
        } else if (parsed.url === '/task/complete') {
          // Installation complete
          return this.parseJsonResult(parsed.body);
        }
        break;
      }

      case 'response':
        // REST response — typically handled inline by sendRequest().
        // Unexpected here; ignore.
        break;

      case 'init':
        // Unexpected init message after setup; ignore.
        break;
    }

    return null;
  }

  /**
   * Build XPD data for the app installation request.
   *
   * XPD is an INI-format file that tells the camera where to connect
   * and includes an HMAC-SHA256 checksum (CIC) for validation.
   * The CIC is computed over the TCD URL using the Sony XPD key.
   *
   * @param tcdUrl - The portal URL that the camera will connect to.
   */
  private async buildXpdData(tcdUrl: string): Promise<Uint8Array> {
    const cic = await this.computeXpdCic(tcdUrl);

    const xpdContent =
      '[DrmTCD]\n' +
      `TCD = ${tcdUrl}\n` +
      'TKN = direct-install\n' +
      `CIC = ${cic}\n`;
    return new TextEncoder().encode(xpdContent);
  }

  /**
   * Compute the CIC (Content Integrity Check) for an XPD field value.
   *
   * Uses HMAC-SHA256 with the Sony XPD key, matching the algorithm in
   * ScalarAMarket and ScalarAUsbDlApp native libraries.
   *
   * @param data - The string to compute the checksum over (typically the TCD URL).
   * @returns Hex-encoded HMAC-SHA256 digest.
   */
  private async computeXpdCic(data: string): Promise<string> {
    const keyBytes = new TextEncoder().encode(XPD_CIC_KEY);
    const dataBytes = new TextEncoder().encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const hashArray = new Uint8Array(signature);
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build a REST start request with XPD data payload.
   *
   * Format: POST /task/start REST/1.0\r\nContent-type: application/x-psn-dstartup2\r\n\r\n<data>
   */
  private buildRestStartRequest(xpdData: Uint8Array): Uint8Array {
    const header = new TextEncoder().encode(
      'POST /task/start REST/1.0\r\n' +
      'Content-type: application/x-psn-dstartup2\r\n' +
      '\r\n',
    );
    const request = new Uint8Array(header.length + xpdData.length);
    request.set(header, 0);
    request.set(xpdData, header.length);
    return request;
  }

  /**
   * Parse a REST request message from the camera.
   *
   * Format: METHOD URL PROTOCOL\r\nHeaders\r\n\r\nBody
   */
  private parseRestRequest(data: Uint8Array): { method: string; url: string; body: Uint8Array } {
    const text = new TextDecoder('latin1').decode(data);
    const headerEnd = text.indexOf('\r\n\r\n');
    const headerSection = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
    const body = headerEnd >= 0 ? data.slice(headerEnd + 4) : new Uint8Array(0);

    const firstLine = headerSection.split('\r\n')[0];
    const parts = firstLine.split(' ');
    const method = parts[0] || '';
    const url = parts[1] || '';

    return { method, url, body };
  }

  /**
   * Parse a JSON result response from the camera.
   *
   * The response may be a raw JSON body or prefixed with REST headers.
   * Header formats vary — sometimes with \r\n\r\n separators, sometimes
   * the JSON starts inline after the headers. We extract the first JSON
   * object found in the text.
   *
   * Expected JSON format: { "resultCode": number, "message": string }
   */
  private parseJsonResult(data: Uint8Array): InstallResult {
    const text = new TextDecoder('latin1').decode(data);

    // Find the start of the JSON object — handles all header formats
    let jsonText = text;
    if (text.startsWith('REST/')) {
      // Try \r\n\r\n separator first
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        jsonText = text.slice(headerEnd + 4);
      } else {
        // No standard separator — find the first '{' character
        const jsonStart = text.indexOf('{');
        if (jsonStart >= 0) {
          jsonText = text.slice(jsonStart);
        }
      }
    }

    // Trim trailing whitespace and null bytes that the camera may append
    jsonText = jsonText.replace(/[\s\0]+$/, '');

    try {
      const parsed = JSON.parse(jsonText) as { resultCode: number; message: string };
      return { code: parsed.resultCode, message: parsed.message };
    } catch {
      return { code: -1, message: `Failed to parse result: ${text.slice(0, 200)}` };
    }
  }

  /**
   * Parse a JSON status/progress message from the camera.
   *
   * Expected format: { "status": number, "status text": string, "percent": number, "total size": number }
   */
  private parseJsonStatus(data: Uint8Array): {
    code: number;
    message: string;
    percent: number;
    totalSize: number;
  } {
    const text = new TextDecoder('latin1').decode(data).replace(/[\s\0]+$/, '');
    try {
      const parsed = JSON.parse(text) as {
        status: number;
        'status text': string;
        percent: number;
        'total size': number;
      };
      return {
        code: parsed.status,
        message: parsed['status text'],
        percent: parsed.percent,
        totalSize: parsed['total size'],
      };
    } catch {
      return { code: -1, message: 'Unknown status', percent: 0, totalSize: 0 };
    }
  }

  /**
   * Delay execution for the specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}
