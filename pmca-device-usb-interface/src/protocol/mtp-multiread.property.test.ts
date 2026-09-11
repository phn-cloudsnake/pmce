// Feature: pmca-typescript-port, Property 16: Multi-read packet reassembly
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MtpDriver } from './mtp-driver.js';
import {
  PTP_HEADER_SIZE,
  PTP_TYPE_DATA,
  PTP_TYPE_RESPONSE,
  PTP_MAX_PKG_LEN,
  PTP_RC_OK,
} from '../constants.js';
import { StructUtil } from '../utils/struct-util.js';
import type { WebUsbBackend } from '../transport/web-usb-backend.js';

/**
 * Validates: Requirements 2.7
 *
 * Property 16: Multi-read packet reassembly
 * For any PTP response packet with declared size exceeding 512 bytes,
 * the MTP driver SHALL continue reading until total received bytes equals
 * the declared size, and the reassembled data SHALL equal the original complete packet.
 */

/** PTP header struct for constructing test packets. */
const PtpHeaderStruct = new StructUtil([
  { name: 'size', type: 'int32' },
  { name: 'type', type: 'int16' },
  { name: 'code', type: 'int16' },
  { name: 'transaction', type: 'int32' },
]);

/**
 * Build a complete PTP packet (header + payload).
 */
function buildPtpPacket(
  type: number,
  code: number,
  transaction: number,
  payload: Uint8Array,
): Uint8Array {
  const totalSize = PTP_HEADER_SIZE + payload.length;
  const header = PtpHeaderStruct.pack({
    size: totalSize,
    type,
    code,
    transaction,
  });
  const packet = new Uint8Array(totalSize);
  packet.set(header, 0);
  packet.set(payload, PTP_HEADER_SIZE);
  return packet;
}

/**
 * Create a mock WebUsbBackend that returns queued responses on read
 * and captures written data.
 */
function createMockBackend(readResponses: Uint8Array[]): WebUsbBackend {
  let readIndex = 0;

  return {
    read(_length: number): Promise<Uint8Array> {
      if (readIndex < readResponses.length) {
        return Promise.resolve(readResponses[readIndex++]);
      }
      return Promise.resolve(new Uint8Array(0));
    },
    write(_data: Uint8Array): Promise<void> {
      return Promise.resolve();
    },
  } as unknown as WebUsbBackend;
}

describe('MtpDriver multi-read packet reassembly property test', () => {
  it('reassembles packets larger than 512 bytes correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate payload sizes from 501 to 5000 bytes so total packet > 512
        fc.integer({ min: 501, max: 5000 }),
        fc.integer({ min: 0, max: 0xffff }).map((n) => n & 0xffff), // random code
        fc.integer({ min: 0, max: 0xffffff }), // random transaction
        async (payloadSize, code, transaction) => {
          // Generate random payload content
          const payload = new Uint8Array(payloadSize);
          for (let i = 0; i < payloadSize; i++) {
            payload[i] = (i * 7 + 13) & 0xff; // deterministic but varied pattern
          }

          // Build the complete DATA packet (header + payload)
          const dataPacket = buildPtpPacket(PTP_TYPE_DATA, code, transaction, payload);

          // Verify the total packet exceeds PTP_MAX_PKG_LEN
          expect(dataPacket.length).toBeGreaterThan(PTP_MAX_PKG_LEN);

          // Split the data packet at the 512-byte boundary
          const firstChunk = dataPacket.slice(0, PTP_MAX_PKG_LEN);
          const remainingChunk = dataPacket.slice(PTP_MAX_PKG_LEN);

          // Build a RESPONSE packet (small, fits in one read)
          const responsePacket = buildPtpPacket(
            PTP_TYPE_RESPONSE,
            PTP_RC_OK,
            transaction,
            new Uint8Array(0),
          );

          // Mock backend: first read returns 512 bytes, second read returns the rest,
          // third read returns the response packet
          const mockBackend = createMockBackend([
            firstChunk,
            remainingChunk,
            responsePacket,
          ]);

          const driver = new MtpDriver(mockBackend);

          // Use sendReadCommand to trigger reading a DATA packet then a RESPONSE
          const result = await driver.sendReadCommand(code, []);

          // Verify the reassembled data equals the original payload
          expect(result.data.length).toBe(payload.length);
          expect(result.data).toEqual(payload);
          expect(result.responseCode).toBe(PTP_RC_OK);
        },
      ),
      { numRuns: 100 },
    );
  });
});
