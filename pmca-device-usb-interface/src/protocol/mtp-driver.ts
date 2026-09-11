/**
 * PTP/MTP protocol driver for communicating with Sony cameras.
 *
 * Handles PTP packet framing, transaction management, multi-read reassembly,
 * and empty-read retry logic over a WebUSB backend.
 *
 * Inspired by libptp2 and the Python MtpDriver implementation.
 */

import {
  PTP_HEADER_SIZE,
  PTP_TYPE_COMMAND,
  PTP_TYPE_DATA,
  PTP_TYPE_RESPONSE,
  PTP_MAX_PKG_LEN,
} from '../constants.js';
import { MtpProtocolError } from '../errors.js';
import { StructUtil } from '../utils/struct-util.js';
import type { UsbTransport } from '../transport/usb-transport.js';

/** PTP packet header struct: 12 bytes, little-endian. */
const PtpHeaderStruct = new StructUtil([
  { name: 'size', type: 'int32' },
  { name: 'type', type: 'int16' },
  { name: 'code', type: 'int16' },
  { name: 'transaction', type: 'int32' },
]);

/**
 * MTP driver that sends and receives PTP/MTP packets over USB bulk endpoints.
 *
 * Provides three command patterns:
 * - `sendCommand`: command → response (no data phase)
 * - `sendWriteCommand`: command → data out → response
 * - `sendReadCommand`: command → data in → response
 */
export class MtpDriver {
  private backend: UsbTransport;
  private transaction: number;
  private isFirstCommand: boolean;

  constructor(backend: UsbTransport) {
    this.backend = backend;
    this.transaction = 0;
    this.isFirstCommand = true;
  }

  /**
   * Send a PTP/MTP command without data phase.
   * @param code - The PTP operation code.
   * @param args - Command arguments (each uint32).
   * @returns The PTP response code.
   */
  async sendCommand(code: number, args: number[]): Promise<number> {
    this.nextTransaction();
    await this.writePtp(PTP_TYPE_COMMAND, code, this.transaction, this.packArgs(args));
    return this.readResponse();
  }

  /**
   * Open a PTP session with the device.
   *
   * Must be called before any other MTP operations on a real device.
   * Sends PTP_OC_OpenSession (0x1002) with session ID 1.
   * Tolerates "session already opened" responses.
   *
   * @returns The PTP response code.
   */
  async openSession(): Promise<number> {
    const PTP_OC_OpenSession = 0x1002;
    const PTP_RC_SessionAlreadyOpened = 0x201e;

    const responseCode = await this.sendCommand(PTP_OC_OpenSession, [1]);
    if (responseCode !== 0x2001 && responseCode !== PTP_RC_SessionAlreadyOpened) {
      throw new MtpProtocolError(
        `Failed to open PTP session: 0x${responseCode.toString(16)}`,
        responseCode,
      );
    }
    return responseCode;
  }

  /**
   * Close the PTP session with the device.
   * Sends PTP_OC_CloseSession (0x1003).
   */
  async closeSession(): Promise<void> {
    const PTP_OC_CloseSession = 0x1003;
    await this.sendCommand(PTP_OC_CloseSession, []);
  }

  /**
   * Send a PTP/MTP command with a write data phase.
   * @param code - The PTP operation code.
   * @param args - Command arguments (each uint32).
   * @param data - The data payload to send.
   * @returns The PTP response code.
   */
  async sendWriteCommand(code: number, args: number[], data: Uint8Array): Promise<number> {
    this.nextTransaction();
    await this.writePtp(PTP_TYPE_COMMAND, code, this.transaction, this.packArgs(args));
    await this.writePtp(PTP_TYPE_DATA, code, this.transaction, data);
    return this.readResponse();
  }

  /**
   * Send a PTP/MTP command with a read data phase.
   * @param code - The PTP operation code.
   * @param args - Command arguments (each uint32).
   * @returns An object with the response code and received data.
   */
  async sendReadCommand(
    code: number,
    args: number[],
  ): Promise<{ responseCode: number; data: Uint8Array }> {
    this.nextTransaction();
    await this.writePtp(PTP_TYPE_COMMAND, code, this.transaction, this.packArgs(args));
    const data = await this.readData();
    const responseCode = await this.readResponse();
    return { responseCode, data };
  }

  /**
   * Advance the transaction ID for the next command sequence.
   *
   * Mirrors the Python behavior: first command uses 0, each subsequent
   * command increments by 1 (so the sequence is 0, 1, 2, 3, ...).
   */
  private nextTransaction(): void {
    // Python: try transaction += 1; except AttributeError: transaction = 0
    // This means: first call → 0, second call → 1, third → 2, ...
    // We use a flag-less approach: start at -1 in a sense, but actually
    // we track whether this is the first call using the initial value.
    // Since constructor sets transaction = 0, the first call should use 0.
    // Subsequent calls increment before use.
    if (this.isFirstCommand) {
      this.isFirstCommand = false;
    } else {
      this.transaction += 1;
    }
  }

  /**
   * Write a PTP packet (header + data payload) to the backend.
   */
  private async writePtp(
    type: number,
    code: number,
    transaction: number,
    data: Uint8Array,
  ): Promise<void> {
    const header = PtpHeaderStruct.pack({
      size: PTP_HEADER_SIZE + data.length,
      type,
      code,
      transaction,
    });

    const packet = new Uint8Array(header.length + data.length);
    packet.set(header, 0);
    packet.set(data, header.length);

    await this.backend.write(packet);
  }

  /**
   * Read a PTP packet from the backend with empty-read retry and multi-read
   * reassembly for packets exceeding PTP_MAX_PKG_LEN bytes.
   *
   * @returns Tuple of [type, code, transaction, payload data].
   */
  private async readPtp(): Promise<{
    type: number;
    code: number;
    transaction: number;
    data: Uint8Array;
  }> {
    // Empty-read retry: keep reading until we get non-empty data
    let rawData = await this.backend.read(PTP_MAX_PKG_LEN);
    while (rawData.length === 0) {
      rawData = await this.backend.read(PTP_MAX_PKG_LEN);
    }

    const header = PtpHeaderStruct.unpack(rawData);
    if (!header) {
      throw new MtpProtocolError('Received packet too short for PTP header', 0);
    }

    const declaredSize = header['size'] as number;

    // Multi-read reassembly: if declared size > PTP_MAX_PKG_LEN, read more
    if (declaredSize > PTP_MAX_PKG_LEN) {
      const remaining = declaredSize - rawData.length;
      const additionalData = await this.backend.read(remaining);
      const combined = new Uint8Array(rawData.length + additionalData.length);
      combined.set(rawData, 0);
      combined.set(additionalData, rawData.length);
      rawData = combined;
    }

    // Extract payload (everything after the header, up to declared size)
    const payload = rawData.slice(PTP_HEADER_SIZE, declaredSize);

    return {
      type: header['type'] as number,
      code: header['code'] as number,
      transaction: header['transaction'] as number,
      data: payload,
    };
  }

  /**
   * Read a DATA packet from the backend.
   * Throws MtpProtocolError if the received packet is not TYPE_DATA.
   */
  private async readData(): Promise<Uint8Array> {
    const { type, data } = await this.readPtp();
    if (type !== PTP_TYPE_DATA) {
      throw new MtpProtocolError(
        `Expected DATA packet (type ${PTP_TYPE_DATA}), got type 0x${type.toString(16)}`,
        type,
      );
    }
    return data;
  }

  /**
   * Read a RESPONSE packet from the backend.
   * Throws MtpProtocolError if the received packet is not TYPE_RESPONSE.
   */
  private async readResponse(): Promise<number> {
    const { type, code } = await this.readPtp();
    if (type !== PTP_TYPE_RESPONSE) {
      throw new MtpProtocolError(
        `Expected RESPONSE packet (type ${PTP_TYPE_RESPONSE}), got type 0x${type.toString(16)}`,
        type,
      );
    }
    return code;
  }

  /**
   * Pack command arguments as a sequence of uint32 little-endian values.
   */
  private packArgs(args: number[]): Uint8Array {
    const buffer = new ArrayBuffer(args.length * 4);
    const view = new DataView(buffer);
    for (let i = 0; i < args.length; i++) {
      view.setUint32(i * 4, args[i], true); // little-endian
    }
    return new Uint8Array(buffer);
  }
}
