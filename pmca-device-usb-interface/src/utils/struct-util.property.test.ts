// Feature: pmca-typescript-port, Property 1: Struct pack/unpack round-trip
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { StructUtil, type FieldDef, type ByteOrder } from './struct-util.js';

/**
 * Validates: Requirements 17.1, 17.2, 17.3, 17.5
 *
 * Property 1: Struct pack/unpack round-trip
 * For any valid field definition set and for any byte ordering,
 * packing then unpacking a struct SHALL produce field values identical to the originals.
 */

/** Arbitrary for generating a random field definition. */
const arbFieldDef: fc.Arbitrary<FieldDef> = fc.oneof(
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'f') || 'f'),
    type: fc.constant('int8' as const),
  }),
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'f') || 'f'),
    type: fc.constant('int16' as const),
  }),
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'f') || 'f'),
    type: fc.constant('int32' as const),
  }),
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'f') || 'f'),
    type: fc.constant('str' as const),
    length: fc.integer({ min: 1, max: 32 }),
  }),
);

/** Generate a list of field definitions with unique names. */
const arbFieldDefs: fc.Arbitrary<FieldDef[]> = fc
  .array(arbFieldDef, { minLength: 1, maxLength: 8 })
  .map((fields) => {
    // Ensure unique names by appending index
    return fields.map((f, i) => ({ ...f, name: `${f.name}${i}` }));
  });

/** Arbitrary for byte order. */
const arbByteOrder: fc.Arbitrary<ByteOrder> = fc.oneof(
  fc.constant('little-endian' as const),
  fc.constant('big-endian' as const),
);

/** Generate a valid value for a given field definition. */
function arbValueForField(field: FieldDef): fc.Arbitrary<number | Uint8Array> {
  switch (field.type) {
    case 'int8':
      return fc.integer({ min: 0, max: 255 });
    case 'int16':
      return fc.integer({ min: 0, max: 65535 });
    case 'int32':
      return fc.integer({ min: 0, max: 4294967295 });
    case 'str':
      return fc.uint8Array({ minLength: field.length!, maxLength: field.length! });
  }
}

/** Generate a valid values object for a given set of field definitions. */
function arbValuesForFields(fields: FieldDef[]): fc.Arbitrary<Record<string, number | Uint8Array>> {
  const entries = fields.map((field) =>
    arbValueForField(field).map((value) => [field.name, value] as const),
  );
  return fc.tuple(...entries).map((pairs) => Object.fromEntries(pairs));
}

describe('StructUtil property-based tests', () => {
  it('pack/unpack round-trip preserves all field values', () => {
    fc.assert(
      fc.property(
        arbFieldDefs.chain((fields) =>
          fc.tuple(
            fc.constant(fields),
            arbByteOrder,
            arbValuesForFields(fields),
          ),
        ),
        ([fields, byteOrder, values]) => {
          const struct = new StructUtil(fields, byteOrder);
          const packed = struct.pack(values);
          const unpacked = struct.unpack(packed);

          expect(unpacked).not.toBeNull();

          for (const field of fields) {
            const original = values[field.name];
            const restored = unpacked![field.name];

            if (field.type === 'str') {
              // Compare Uint8Arrays
              expect(restored).toEqual(original);
            } else {
              // Compare numbers
              expect(restored).toBe(original);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
