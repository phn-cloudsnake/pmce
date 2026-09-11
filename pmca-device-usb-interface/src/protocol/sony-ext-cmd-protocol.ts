/**
 * Sony Extended Command (ExtCmd) protocol layer.
 *
 * Wraps MTP commands with a 16-byte Sony ExtCmd header, handles
 * busy-retry logic, and manages the write/read command phases.
 */

import {
  PTP_OC_SonyDiExtCmd_write,
  PTP_OC_SonyDiExtCmd_read,
  PTP_RC_OK,
  PTP_RC_DeviceBusy,
  PTP_RC_ParameterNotSupported,
  EXTCMD_HEADER_SIZE,
  EXTCMD_WRITE_BUFFER_SIZE,
  EXTCMD_READ_BUFFER_SIZE,
  EXTCMD_MAX_BUSY_RETRIES,
} from '../constants.js';
import { ExtCmdError, InvalidCommandError, TimeoutError } from '../errors.js';
import { StructUtil } from '../utils/struct-util.js';
import type { MtpDriver } from './mtp-driver.js';

/** ExtCmd header struct: 16 bytes, little-endian. */
const ExtCmdHeaderStruct = new StructUtil([
  { name: 'dataSize', type: 'int32' },
  { name: 'cmd', type: 'int16' },
  { name: 'direction', type: 'int16' },
  { name: 'reserved', type: 'str', length: 8 },
]);

/**
 * Sony Extended Command protocol.
 *
 * Encapsulates ExtCmd header construction, busy-retry logic, and the
 * write/read command phases used to communicate with Sony cameras.
 */
export class SonyExtCmdProtocol {
  private driver: MtpDriver;

  constructor(driver: MtpDriver) {
    this.driver = driver;
  }

  /**
   * Send an extended command to the camera.
   *
   * @param group - The ExtCmd group number (used as MTP parameter).
   * @param cmd - The ExtCmd command number within the group (placed in header).
   * @param data - Optional payload data to send with the command.
   * @param writeBufferSize - Size of the write buffer (default 0x2000).
   * @param readBufferSize - Size of the read buffer (default 0x2000). Set to 0 to skip read phase.
   * @returns The response payload data (with ExtCmd header stripped), or empty Uint8Array if readBufferSize is 0.
   */
  async sendCommand(
    group: number,
    cmd: number,
    data: Uint8Array = new Uint8Array(0),
    writeBufferSize: number = EXTCMD_WRITE_BUFFER_SIZE,
    readBufferSize: number = EXTCMD_READ_BUFFER_SIZE,
  ): Promise<Uint8Array> {
    // Build the ExtCmd header for write phase
    // Python: cmd field = sub-command number, direction = 0
    const writeHeader = ExtCmdHeaderStruct.pack({
      dataSize: data.length,
      cmd: cmd,
      direction: 0,
      reserved: new Uint8Array(8),
    });

    // Build padded write buffer: header + payload + zero-padding
    const paddedData = new Uint8Array(writeBufferSize);
    paddedData.set(writeHeader, 0);
    paddedData.set(data, EXTCMD_HEADER_SIZE);

    // Write phase with busy-retry (MTP arg is the group number)
    await this.sendWriteWithRetry(group, paddedData);

    // If readBufferSize is 0, skip read phase
    if (readBufferSize === 0) {
      return new Uint8Array(0);
    }

    // Read phase with busy-retry (MTP arg is the group number)
    const readData = await this.sendReadWithRetry(group, readBufferSize);

    // Parse the ExtCmd header from the read response to get data size
    const responseHeader = ExtCmdHeaderStruct.unpack(readData);
    if (responseHeader === null) {
      return new Uint8Array(0);
    }

    const responseDataSize = responseHeader['dataSize'] as number;
    return readData.slice(EXTCMD_HEADER_SIZE, EXTCMD_HEADER_SIZE + responseDataSize);
  }

  /**
   * Execute the write phase with busy-retry logic.
   * Retries on DeviceBusy (0x2019) up to EXTCMD_MAX_BUSY_RETRIES times.
   */
  private async sendWriteWithRetry(
    group: number,
    paddedData: Uint8Array,
  ): Promise<void> {
    for (let attempt = 0; attempt < EXTCMD_MAX_BUSY_RETRIES; attempt++) {
      const responseCode = await this.driver.sendWriteCommand(
        PTP_OC_SonyDiExtCmd_write,
        [group],
        paddedData,
      );

      if (responseCode === PTP_RC_OK) {
        return;
      }

      if (responseCode === PTP_RC_DeviceBusy) {
        continue;
      }

      if (responseCode === PTP_RC_ParameterNotSupported) {
        throw new InvalidCommandError(
          `Command not supported (response 0x${responseCode.toString(16)})`,
        );
      }

      throw new ExtCmdError(
        `Unexpected response during write phase: 0x${responseCode.toString(16)}`,
        responseCode,
      );
    }

    throw new TimeoutError(
      `Device busy timeout: exceeded ${EXTCMD_MAX_BUSY_RETRIES} retry attempts during write phase`,
    );
  }

  /**
   * Execute the read phase with busy-retry logic.
   * Retries on DeviceBusy (0x2019) up to EXTCMD_MAX_BUSY_RETRIES times.
   */
  private async sendReadWithRetry(group: number, readBufferSize: number): Promise<Uint8Array> {
    for (let attempt = 0; attempt < EXTCMD_MAX_BUSY_RETRIES; attempt++) {
      const { responseCode, data } = await this.driver.sendReadCommand(
        PTP_OC_SonyDiExtCmd_read,
        [group],
      );

      if (responseCode === PTP_RC_OK) {
        return data;
      }

      if (responseCode === PTP_RC_DeviceBusy) {
        continue;
      }

      if (responseCode === PTP_RC_ParameterNotSupported) {
        throw new InvalidCommandError(
          `Command not supported (response 0x${responseCode.toString(16)})`,
        );
      }

      throw new ExtCmdError(
        `Unexpected response during read phase: 0x${responseCode.toString(16)}`,
        responseCode,
      );
    }

    throw new TimeoutError(
      `Device busy timeout: exceeded ${EXTCMD_MAX_BUSY_RETRIES} retry attempts during read phase`,
    );
  }
}
