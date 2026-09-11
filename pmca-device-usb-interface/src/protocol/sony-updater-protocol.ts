/**
 * Sony Updater Protocol layer.
 *
 * Implements the subset of the firmware updater packet protocol needed to
 * read firmware version information for the camera info() command:
 * init and version query. Firmware writing is out of scope for this build.
 */

import {
  SONY_CMD_Updater,
  CMD_INIT,
  CMD_QUERY_VERSION,
  UPDATER_PROTOCOL_VERSION,
  UPDATER_ERR_OK,
  UPDATER_ERR_SEQUENCE,
  UPDATER_BUFFER_SIZE,
  EXTCMD_HEADER_SIZE,
} from '../constants.js';
import { FirmwareUpdateError } from '../errors.js';
import { StructUtil } from '../utils/struct-util.js';
import type { SonyExtCmdProtocol } from './sony-ext-cmd-protocol.js';

/** Firmware version information returned by queryVersion(). */
export interface UpdaterVersions {
  oldVersion: string;
  newVersion: string;
}

/** Updater packet header: 32 bytes, little-endian. */
const UpdaterPacketHeaderStruct = new StructUtil([
  { name: 'bodySize', type: 'int32' },
  { name: 'protocolVersion', type: 'int16' },
  { name: 'commandId', type: 'int16' },
  { name: 'responseId', type: 'int16' },
  { name: 'sequenceNumber', type: 'int16' },
  { name: 'reserved', type: 'str', length: 20 },
]);

/** Query version response struct: 8 bytes. */
const QueryVersionResponseStruct = new StructUtil([
  { name: 'oldFirmMinorVersion', type: 'int16' },
  { name: 'oldFirmMajorVersion', type: 'int16' },
  { name: 'newFirmMinorVersion', type: 'int16' },
  { name: 'newFirmMajorVersion', type: 'int16' },
]);

/**
 * Format a firmware version as "%x.%02x".
 *
 * @param major - Major version byte (0–255).
 * @param minor - Minor version byte (0–255).
 * @returns Formatted version string (e.g., "3.10" for major=3, minor=0x10).
 */
export function formatVersion(major: number, minor: number): string {
  return major.toString(16) + '.' + minor.toString(16).padStart(2, '0');
}

/**
 * Sony Updater Protocol.
 *
 * Encapsulates the updater commands needed by info(): init and version query.
 */
export class SonyUpdaterProtocol {
  private extCmd: SonyExtCmdProtocol;

  constructor(extCmd: SonyExtCmdProtocol) {
    this.extCmd = extCmd;
  }

  /**
   * Send an updater command and parse the response header.
   *
   * @param command - The updater command ID.
   * @param data - Optional payload data.
   * @param bufferSize - Write buffer size (default UPDATER_BUFFER_SIZE).
   * @returns The response body (after the updater packet header).
   */
  private async sendCommand(
    command: number,
    data: Uint8Array = new Uint8Array(0),
    bufferSize: number = UPDATER_BUFFER_SIZE,
  ): Promise<Uint8Array> {
    const commandHeader = UpdaterPacketHeaderStruct.pack({
      bodySize: data.length,
      protocolVersion: UPDATER_PROTOCOL_VERSION,
      commandId: command,
      responseId: 0,
      sequenceNumber: 0,
      reserved: new Uint8Array(20),
    });

    // Combine header + payload
    const fullPayload = new Uint8Array(commandHeader.length + data.length);
    fullPayload.set(commandHeader, 0);
    fullPayload.set(data, commandHeader.length);

    // The write buffer must be large enough for the ExtCmd header (16 bytes) + payload.
    // When bufferSize=0 (e.g., for CMD_COMPLETE), only the read phase is skipped;
    // the write phase still needs a valid buffer size.
    const writeBufferSize = Math.max(bufferSize, fullPayload.length + EXTCMD_HEADER_SIZE);

    const response = await this.extCmd.sendCommand(
      SONY_CMD_Updater,
      0, // cmd within group (updater uses group-level addressing)
      fullPayload,
      writeBufferSize,
      bufferSize,
    );

    if (bufferSize === 0) {
      return new Uint8Array(0);
    }

    // Parse the updater response header
    const responseHeader = UpdaterPacketHeaderStruct.unpack(response);
    if (responseHeader === null) {
      return new Uint8Array(0);
    }

    const responseId = responseHeader['responseId'] as number;
    if (responseId !== UPDATER_ERR_OK) {
      if (responseId === UPDATER_ERR_SEQUENCE) {
        throw new FirmwareUpdateError(
          'Updater sequence error',
          responseId,
          'Sequence error',
        );
      }
      throw new FirmwareUpdateError(
        `Updater response error: 0x${responseId.toString(16)}`,
        responseId,
        `Response error 0x${responseId.toString(16)}`,
      );
    }

    const bodySize = responseHeader['bodySize'] as number;
    return response.slice(
      UpdaterPacketHeaderStruct.size,
      UpdaterPacketHeaderStruct.size + bodySize,
    );
  }

  /**
   * Initialize the updater protocol.
   * Sends CMD_INIT (0x1) with no body.
   */
  async init(): Promise<void> {
    await this.sendCommand(CMD_INIT);
  }

  /**
   * Query the current and new firmware versions.
   * Sends CMD_QUERY_VERSION (0x20) and parses the version response.
   *
   * @returns Object with oldVersion and newVersion as formatted strings.
   */
  async queryVersion(): Promise<UpdaterVersions> {
    const responseBody = await this.sendCommand(CMD_QUERY_VERSION);
    const versionData = QueryVersionResponseStruct.unpack(responseBody);

    if (versionData === null) {
      throw new FirmwareUpdateError(
        'Failed to parse version response',
        0,
        'Invalid version response',
      );
    }

    const oldMajor = versionData['oldFirmMajorVersion'] as number;
    const oldMinor = versionData['oldFirmMinorVersion'] as number;
    const newMajor = versionData['newFirmMajorVersion'] as number;
    const newMinor = versionData['newFirmMinorVersion'] as number;

    return {
      oldVersion: formatVersion(oldMajor, oldMinor),
      newVersion: formatVersion(newMajor, newMinor),
    };
  }

}
