// Feature: pmca-typescript-port, Property 2: SPK↔APK round-trip
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SpkCodec } from './spk-codec.js';

/**
 * Validates: Requirements 7.1, 7.2, 7.5, 8.2, 8.3, 8.4
 *
 * Property 2: SPK↔APK round-trip
 * For any valid APK input (Uint8Array with length 1 to 10KB), converting to SPK
 * via `apkToSpk` then back to APK via `spkToApk` SHALL produce output byte-for-byte
 * identical to the original APK data.
 */

describe('SpkCodec property-based tests', () => {
  it('apkToSpk then spkToApk produces byte-for-byte identical output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 10240 }),
        async (apkData) => {
          const spk = await SpkCodec.apkToSpk(apkData);
          const roundTripped = await SpkCodec.spkToApk(spk);
          expect(roundTripped).toEqual(apkData);
        },
      ),
      { numRuns: 100 },
    );
  });
});
