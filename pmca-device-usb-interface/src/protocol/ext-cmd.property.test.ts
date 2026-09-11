/**
 * Property-based tests for SonyExtCmdProtocol header and padding.
 *
 * Feature: pmca-typescript-port, Property 6: ExtCmd header and padding invariant
 *
 * Validates: Requirements 3.2
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { SonyExtCmdProtocol } from './sony-ext-cmd-protocol.js';
import {
  EXTCMD_HEADER_SIZE,
  PTP_RC_OK,
  PTP_OC_SonyDiExtCmd_write,
  PTP_OC_SonyDiExtCmd_read,
} from '../constants.js';
import { StructUtil } from '../utils/struct-util.js';
import type { MtpDriver } from './mtp-driver.js';

/** ExtCmd header struct for verifying header fields in transmitted packets. */
const ExtCmdHeaderStruct = new StructUtil([
  { name: 'dataSize', type: 'int32' },
  { name: 'cmd', type: 'int16' },
  { name: 'direction', type: 'int16' },
  { name: 'reserved', type: 'str', length: 8 },
]);

/**
 * Build a valid ExtCmd read response that includes a proper header
 * followed by empty payload data.
 */
function buildExtCmdReadResponse(bufferSize: number): Uint8Array {
  const response = new Uint8Array(bufferSize);
  const header = ExtCmdHeaderStruct.pack({
    dataSize: 0,
    cmd: 0,
    direction: 2, // EXTCMD_DIRECTION_READ
    reserved: new Uint8Array(8),
  });
  response.set(header, 0);
  return response;
}

/**
 * Mock MtpDriver that records data passed to sendWriteCommand
 * and returns PTP_RC_OK from sendWriteCommand and a valid ExtCmd
 * response from sendReadCommand.
 */
class MockMtpDriver {
  /** All data written via sendWriteCommand, in order. */
  public writtenData: Uint8Array[] = [];
  /** Args passed to sendWriteCommand. */
  public writtenArgs: number[][] = [];

  async sendWriteCommand(
    _code: number,
    args: number[],
    data: Uint8Array,
  ): Promise<number> {
    this.writtenArgs.push([...args]);
    this.writtenData.push(new Uint8Array(data));
    return PTP_RC_OK;
  }

  async sendReadCommand(
    _code: number,
    args: number[],
  ): Promise<{ responseCode: number; data: Uint8Array }> {
    return {
      responseCode: PTP_RC_OK,
      data: buildExtCmdReadResponse(0x2000),
    };
  }
}

describe('Property 6: ExtCmd header and padding invariant', () => {
  test.each([{ numRuns: 100 }])(
    'For any payload of L bytes sent with writeBufferSize B (B >= 16 + L), the transmitted packet is exactly B bytes with correct header, payload, and zero-padding',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate payload data (0–500 bytes)
          fc.uint8Array({ minLength: 0, maxLength: 500 }),
          // Generate extra padding beyond minimum required size (0–200 extra bytes)
          fc.integer({ min: 0, max: 200 }),
          // Generate group and cmd for ExtCmd
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          async (payload, extraPadding, group, cmd) => {
            const writeBufferSize = EXTCMD_HEADER_SIZE + payload.length + extraPadding;
            const mockDriver = new MockMtpDriver();
            const protocol = new SonyExtCmdProtocol(mockDriver as unknown as MtpDriver);

            // Send the command
            await protocol.sendCommand(group, cmd, payload, writeBufferSize);

            // Verify we got exactly one write
            expect(mockDriver.writtenData.length).toBe(1);

            const transmittedPacket = mockDriver.writtenData[0];

            // 1. The transmitted packet is exactly B bytes long
            expect(transmittedPacket.length).toBe(writeBufferSize);

            // 2. The first 16 bytes are the ExtCmd header with correct dataSize = L
            const header = ExtCmdHeaderStruct.unpack(transmittedPacket);
            expect(header).not.toBeNull();
            expect(header!['dataSize']).toBe(payload.length);

            // Verify cmd field: just the sub-command number
            expect(header!['cmd']).toBe(cmd);

            // Verify direction field: 0 (as per Python reference)
            expect(header!['direction']).toBe(0);

            // Verify MTP arg is the group number
            expect(mockDriver.writtenArgs[0]).toEqual([group]);

            // 3. Bytes 16 to 16+L are the payload data
            const extractedPayload = transmittedPacket.slice(
              EXTCMD_HEADER_SIZE,
              EXTCMD_HEADER_SIZE + payload.length,
            );
            expect(extractedPayload).toEqual(payload);

            // 4. Bytes 16+L to B are all zeros (padding)
            const paddingBytes = transmittedPacket.slice(EXTCMD_HEADER_SIZE + payload.length);
            const expectedPadding = new Uint8Array(writeBufferSize - EXTCMD_HEADER_SIZE - payload.length);
            expect(paddingBytes).toEqual(expectedPadding);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
