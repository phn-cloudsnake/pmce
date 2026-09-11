/**
 * Binary serialization utility for packing and unpacking structured data.
 *
 * Supports INT8, INT16, INT32 (unsigned integers) and STR (fixed-length byte arrays).
 * Configurable byte order (little-endian by default).
 */

/** Supported field types for struct definitions. */
export type FieldType = 'int8' | 'int16' | 'int32' | 'str';

/** A single field definition within a struct. */
export interface FieldDef {
  /** Field name used as key in pack/unpack value objects. */
  name: string;
  /** The data type of this field. */
  type: FieldType;
  /** Byte length for 'str' type fields. Required when type is 'str'. */
  length?: number;
}

/** Byte order for multi-byte integer fields. */
export type ByteOrder = 'little-endian' | 'big-endian';

/**
 * Returns the byte size of a single field definition.
 */
function fieldSize(field: FieldDef): number {
  switch (field.type) {
    case 'int8':
      return 1;
    case 'int16':
      return 2;
    case 'int32':
      return 4;
    case 'str':
      return field.length ?? 0;
  }
}

/**
 * StructUtil provides pack/unpack operations for fixed-layout binary structures.
 *
 * Usage:
 * ```ts
 * const s = new StructUtil([
 *   { name: 'cmd', type: 'int16' },
 *   { name: 'size', type: 'int32' },
 *   { name: 'payload', type: 'str', length: 8 },
 * ]);
 *
 * const packed = s.pack({ cmd: 0x1234, size: 100, payload: new Uint8Array(8) });
 * const unpacked = s.unpack(packed);
 * ```
 */
export class StructUtil {
  /** Total byte size of the struct (sum of all field sizes). */
  readonly size: number;

  private readonly fields: FieldDef[];
  private readonly littleEndian: boolean;

  /**
   * @param fields - Array of field definitions describing the struct layout.
   * @param byteOrder - Byte order for multi-byte integers. Defaults to 'little-endian'.
   */
  constructor(fields: FieldDef[], byteOrder: ByteOrder = 'little-endian') {
    this.fields = fields;
    this.littleEndian = byteOrder === 'little-endian';
    this.size = fields.reduce((sum, f) => sum + fieldSize(f), 0);
  }

  /**
   * Pack field values into a Uint8Array of `this.size` bytes.
   *
   * @param values - Object mapping field names to their values.
   *   INT8/INT16/INT32 fields expect a number.
   *   STR fields expect a Uint8Array of the specified length.
   * @returns A new Uint8Array containing the packed binary data.
   */
  pack(values: Record<string, number | Uint8Array>): Uint8Array {
    const buffer = new ArrayBuffer(this.size);
    const view = new DataView(buffer);
    const result = new Uint8Array(buffer);
    let offset = 0;

    for (const field of this.fields) {
      const value = values[field.name];

      switch (field.type) {
        case 'int8':
          view.setUint8(offset, value as number);
          offset += 1;
          break;
        case 'int16':
          view.setUint16(offset, value as number, this.littleEndian);
          offset += 2;
          break;
        case 'int32':
          view.setUint32(offset, value as number, this.littleEndian);
          offset += 4;
          break;
        case 'str': {
          const bytes = value as Uint8Array;
          const len = field.length ?? 0;
          result.set(bytes.subarray(0, len), offset);
          offset += len;
          break;
        }
      }
    }

    return result;
  }

  /**
   * Unpack binary data into a named-field object.
   *
   * @param data - The binary buffer to read from.
   * @param offset - Starting byte offset within `data`. Defaults to 0.
   * @returns An object mapping field names to their values, or null if the
   *   buffer is too short to contain the full struct.
   */
  unpack(data: Uint8Array, offset: number = 0): Record<string, number | Uint8Array> | null {
    if (data.length - offset < this.size) {
      return null;
    }

    const view = new DataView(data.buffer, data.byteOffset + offset, this.size);
    const result: Record<string, number | Uint8Array> = {};
    let pos = 0;

    for (const field of this.fields) {
      switch (field.type) {
        case 'int8':
          result[field.name] = view.getUint8(pos);
          pos += 1;
          break;
        case 'int16':
          result[field.name] = view.getUint16(pos, this.littleEndian);
          pos += 2;
          break;
        case 'int32':
          result[field.name] = view.getUint32(pos, this.littleEndian);
          pos += 4;
          break;
        case 'str': {
          const len = field.length ?? 0;
          result[field.name] = data.slice(offset + pos, offset + pos + len);
          pos += len;
          break;
        }
      }
    }

    return result;
  }
}
