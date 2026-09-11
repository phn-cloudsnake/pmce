/**
 * Property-based tests for MtpDriver PTP packet construction.
 *
 * Feature: pmca-typescript-port, Property 4: PTP packet size field invariant
 *
 * Validates: Requirements 2.1
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { MtpDriver } from './mtp-driver.js';
import {
  PTP_HEADER_SIZE,
  PTP_TYPE_RESPONSE,
  PTP_RC_OK,
} from '../constants.js';
import type { WebUsbBackend } from '../transport/web-usb-backend.js';

/**
 * Build a valid PTP response packet that the mock backend returns
 * when read() is called. This allows the MtpDriver to complete its
 * sendWriteCommand flow without errors.
 */
function buildResponsePacket(transaction: number): Uint8Array {
  const packet = new Uint8Array(PTP_HEADER_SIZE);
  const view = new DataView(packet.buffer);
  view.setUint32(0, PTP_HEADER_SIZE, true); // size = 12 (header only)
  view.setUint16(4, PTP_TYPE_RESPONSE, true); // type = RESPONSE
  view.setUint16(6, PTP_RC_OK, true); // code = OK
  view.setUint32(8, transaction, true); // transaction ID
  return packet;
}

/**
 * Mock WebUsbBackend that records all written data and provides
 * canned PTP response packets when read() is called.
 */
class MockWebUsbBackend {
  /** All data written via write() calls, in order. */
  public writtenPackets: Uint8Array[] = [];

  /** Counter for providing response packets with correct transaction IDs. */
  private readCallCount = 0;

  async write(data: Uint8Array): Promise<void> {
    // Store a copy of the written data
    this.writtenPackets.push(new Uint8Array(data));
  }

  async read(_length: number): Promise<Uint8Array> {
    // Every sendWriteCommand writes 2 packets (command + data), then reads 1 response.
    // Transaction ID starts at 0 for the first command.
    const transaction = this.readCallCount;
    this.readCallCount++;
    return buildResponsePacket(transaction);
  }
}

describe('Property 4: PTP packet size field invariant', () => {
  test.each([{ numRuns: 100 }])(
    'For any payload of N bytes, the 4-byte LE size field equals 12 + N',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10000 }),
          async (payloadLength) => {
            const mockBackend = new MockWebUsbBackend();
            const driver = new MtpDriver(mockBackend as unknown as WebUsbBackend);

            // Create a payload of the specified length
            const payload = new Uint8Array(payloadLength);

            // sendWriteCommand sends: 1) TYPE_COMMAND packet, 2) TYPE_DATA packet
            // We want to verify the size field of the DATA packet (the second write)
            await driver.sendWriteCommand(0x1234, [], payload);

            // The second written packet is the DATA packet containing our payload
            expect(mockBackend.writtenPackets.length).toBe(2);
            const dataPacket = mockBackend.writtenPackets[1];

            // Read the 4-byte LE size field from the beginning of the packet
            const view = new DataView(
              dataPacket.buffer,
              dataPacket.byteOffset,
              dataPacket.byteLength,
            );
            const sizeField = view.getUint32(0, true);

            // Property: size field must equal PTP_HEADER_SIZE (12) + payload length
            expect(sizeField).toBe(PTP_HEADER_SIZE + payloadLength);

            // Also verify the actual packet length matches the size field
            expect(dataPacket.length).toBe(sizeField);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  test.each([{ numRuns: 100 }])(
    'For any payload of N bytes, the COMMAND packet size field equals 12 + args_length',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10000 }),
          fc.array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 0, maxLength: 5 }),
          async (payloadLength, args) => {
            const mockBackend = new MockWebUsbBackend();
            const driver = new MtpDriver(mockBackend as unknown as WebUsbBackend);

            const payload = new Uint8Array(payloadLength);

            await driver.sendWriteCommand(0x1234, args, payload);

            // The first written packet is the COMMAND packet
            const commandPacket = mockBackend.writtenPackets[0];
            const view = new DataView(
              commandPacket.buffer,
              commandPacket.byteOffset,
              commandPacket.byteLength,
            );
            const sizeField = view.getUint32(0, true);

            // COMMAND packet payload is the packed args (4 bytes each)
            const expectedArgsSize = args.length * 4;
            expect(sizeField).toBe(PTP_HEADER_SIZE + expectedArgsSize);
            expect(commandPacket.length).toBe(sizeField);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
