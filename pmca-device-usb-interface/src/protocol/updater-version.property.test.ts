/**
 * Property-based tests for firmware version formatting.
 *
 * Feature: pmca-typescript-port, Property 7: Firmware version formatting
 *
 * Validates: Requirements 4.3
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatVersion } from './sony-updater-protocol.js';

describe('Property 7: Firmware version formatting', () => {
  test('For any major (0–255) and minor (0–255), formatVersion produces correct "%x.%02x" output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (major, minor) => {
          const result = formatVersion(major, minor);

          // 1. Output matches the regex pattern: unpadded hex dot zero-padded 2-digit hex
          expect(result).toMatch(/^[0-9a-f]+\.[0-9a-f]{2}$/);

          // 2. Output equals the expected formatted string
          const expectedMajor = major.toString(16);
          const expectedMinor = minor.toString(16).padStart(2, '0');
          const expected = `${expectedMajor}.${expectedMinor}`;
          expect(result).toBe(expected);

          // 3. Major part is unpadded (no leading zeros unless value is 0)
          const [majorPart] = result.split('.');
          if (major === 0) {
            expect(majorPart).toBe('0');
          } else {
            expect(majorPart[0]).not.toBe('0');
          }

          // 4. Minor part is always exactly 2 characters (zero-padded)
          const minorPart = result.split('.')[1];
          expect(minorPart.length).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
