/**
 * Property-based tests for MTP transaction ID sequencing.
 *
 * Feature: pmca-typescript-port, Property 5: MTP transaction ID sequencing
 *
 * Validates: Requirements 2.5
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
 * Build a valid PTP TYPE_RESPONSE packet with the given transaction ID.
 * The MtpDriver expects a response after each sendCommand call.
 */
function buildResponsePacket(transaction: number): Uint8Array {
  const packet = new Uint8Array(PTP_HEADER_SIZE);
  const view = new DataView(packet.buffer);
  view.setUint32(0, PTP_HEADER_SIZE, true); // size = 12 (header only)
  view.setUint16(4, PTP_TYPE_RESPONSE, true); // type = RESPONSE
  view.setUint16(6, PTP_RC_OK, true); // code = OK (0x2001)
  view.setUint32(8, transaction, true); // transaction ID
  return packet;
}

/**
 * Mock WebUsbBackend that records all written packets and returns
 * valid PTP response packets when read() is called.
 */
class MockWebUsbBackend {
  /** All data written via write() calls, in order. */
  public writtenPackets: Uint8Array[] = [];

  /** Counter for providing sequential response packets. */
  private readCallCount = 0;

  async write(data: Uint8Array): Promise<void> {
    this.writtenPackets.push(new Uint8Array(data));
  }

  async read(_length: number): Promise<Uint8Array> {
    const transaction = this.readCallCount;
    this.readCallCount++;
    return buildResponsePacket(transaction);
  }
}

/**
 * Extract the transaction ID from a captured PTP packet.
 * The transaction ID is a uint32 LE at offset 8 in the 12-byte PTP header.
 */
function extractTransactionId(packet: Uint8Array): number {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return view.getUint32(8, true);
}

describe('Property 5: MTP transaction ID sequencing', () => {
  test(
    'For any sequence of N commands, transaction IDs are sequential 0, 1, 2, …, N−1',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }),
          async (commandCount) => {
            const mockBackend = new MockWebUsbBackend();
            const driver = new MtpDriver(mockBackend as unknown as WebUsbBackend);

            // Send N commands through the driver
            for (let i = 0; i < commandCount; i++) {
              await driver.sendCommand(0x1002, []);
            }

            // Each sendCommand writes exactly one COMMAND packet
            expect(mockBackend.writtenPackets.length).toBe(commandCount);

            // Verify transaction IDs are sequential: 0, 1, 2, …, N−1
            for (let i = 0; i < commandCount; i++) {
              const transactionId = extractTransactionId(mockBackend.writtenPackets[i]);
              expect(transactionId).toBe(i);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
