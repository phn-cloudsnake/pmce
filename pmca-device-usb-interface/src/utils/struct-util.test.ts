import { describe, it, expect } from 'vitest';
import { StructUtil, type FieldDef } from './struct-util.js';

describe('StructUtil', () => {
  describe('size computation', () => {
    it('computes size for int8 fields', () => {
      const s = new StructUtil([{ name: 'a', type: 'int8' }]);
      expect(s.size).toBe(1);
    });

    it('computes size for int16 fields', () => {
      const s = new StructUtil([{ name: 'a', type: 'int16' }]);
      expect(s.size).toBe(2);
    });

    it('computes size for int32 fields', () => {
      const s = new StructUtil([{ name: 'a', type: 'int32' }]);
      expect(s.size).toBe(4);
    });

    it('computes size for str fields based on length', () => {
      const s = new StructUtil([{ name: 'a', type: 'str', length: 10 }]);
      expect(s.size).toBe(10);
    });

    it('computes total size from multiple fields', () => {
      const s = new StructUtil([
        { name: 'cmd', type: 'int16' },
        { name: 'size', type: 'int32' },
        { name: 'data', type: 'str', length: 8 },
      ]);
      expect(s.size).toBe(2 + 4 + 8);
    });

    it('computes 0 for empty fields', () => {
      const s = new StructUtil([]);
      expect(s.size).toBe(0);
    });
  });

  describe('pack()', () => {
    it('packs int8 field correctly', () => {
      const s = new StructUtil([{ name: 'val', type: 'int8' }]);
      const packed = s.pack({ val: 0xAB });
      expect(packed).toEqual(new Uint8Array([0xAB]));
    });

    it('packs int16 field little-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }], 'little-endian');
      const packed = s.pack({ val: 0x1234 });
      expect(packed).toEqual(new Uint8Array([0x34, 0x12]));
    });

    it('packs int16 field big-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }], 'big-endian');
      const packed = s.pack({ val: 0x1234 });
      expect(packed).toEqual(new Uint8Array([0x12, 0x34]));
    });

    it('packs int32 field little-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }], 'little-endian');
      const packed = s.pack({ val: 0xDEADBEEF });
      expect(packed).toEqual(new Uint8Array([0xEF, 0xBE, 0xAD, 0xDE]));
    });

    it('packs int32 field big-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }], 'big-endian');
      const packed = s.pack({ val: 0xDEADBEEF });
      expect(packed).toEqual(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
    });

    it('packs str field by copying bytes', () => {
      const s = new StructUtil([{ name: 'data', type: 'str', length: 4 }]);
      const packed = s.pack({ data: new Uint8Array([1, 2, 3, 4]) });
      expect(packed).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('packs multiple fields sequentially', () => {
      const s = new StructUtil([
        { name: 'type', type: 'int8' },
        { name: 'cmd', type: 'int16' },
        { name: 'payload', type: 'str', length: 3 },
      ], 'little-endian');

      const packed = s.pack({
        type: 0x01,
        cmd: 0x0200,
        payload: new Uint8Array([0xAA, 0xBB, 0xCC]),
      });

      expect(packed).toEqual(new Uint8Array([0x01, 0x00, 0x02, 0xAA, 0xBB, 0xCC]));
    });
  });

  describe('unpack()', () => {
    it('returns null if buffer is too short', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }]);
      const result = s.unpack(new Uint8Array([0x01, 0x02]));
      expect(result).toBeNull();
    });

    it('returns null with offset making buffer too short', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }]);
      const result = s.unpack(new Uint8Array([0, 0, 0, 0, 0]), 3);
      expect(result).toBeNull();
    });

    it('unpacks int8 field', () => {
      const s = new StructUtil([{ name: 'val', type: 'int8' }]);
      const result = s.unpack(new Uint8Array([0xFE]));
      expect(result).toEqual({ val: 0xFE });
    });

    it('unpacks int16 field little-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }], 'little-endian');
      const result = s.unpack(new Uint8Array([0x34, 0x12]));
      expect(result).toEqual({ val: 0x1234 });
    });

    it('unpacks int16 field big-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }], 'big-endian');
      const result = s.unpack(new Uint8Array([0x12, 0x34]));
      expect(result).toEqual({ val: 0x1234 });
    });

    it('unpacks int32 field little-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }], 'little-endian');
      const result = s.unpack(new Uint8Array([0xEF, 0xBE, 0xAD, 0xDE]));
      expect(result).toEqual({ val: 0xDEADBEEF });
    });

    it('unpacks int32 field big-endian', () => {
      const s = new StructUtil([{ name: 'val', type: 'int32' }], 'big-endian');
      const result = s.unpack(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
      expect(result).toEqual({ val: 0xDEADBEEF });
    });

    it('unpacks str field as Uint8Array slice', () => {
      const s = new StructUtil([{ name: 'data', type: 'str', length: 3 }]);
      const result = s.unpack(new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]));
      expect(result).not.toBeNull();
      expect(result!['data']).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]));
    });

    it('unpacks at a given offset', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }], 'little-endian');
      const data = new Uint8Array([0x00, 0x00, 0x34, 0x12]);
      const result = s.unpack(data, 2);
      expect(result).toEqual({ val: 0x1234 });
    });

    it('unpacks multiple fields sequentially', () => {
      const s = new StructUtil([
        { name: 'type', type: 'int8' },
        { name: 'cmd', type: 'int16' },
        { name: 'payload', type: 'str', length: 3 },
      ], 'little-endian');

      const data = new Uint8Array([0x01, 0x00, 0x02, 0xAA, 0xBB, 0xCC]);
      const result = s.unpack(data);
      expect(result).not.toBeNull();
      expect(result!['type']).toBe(0x01);
      expect(result!['cmd']).toBe(0x0200);
      expect(result!['payload']).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]));
    });
  });

  describe('round-trip', () => {
    it('pack then unpack returns original values for integers', () => {
      const s = new StructUtil([
        { name: 'a', type: 'int8' },
        { name: 'b', type: 'int16' },
        { name: 'c', type: 'int32' },
      ]);
      const values = { a: 255, b: 1000, c: 0xCAFEBABE };
      const packed = s.pack(values);
      const unpacked = s.unpack(packed);
      expect(unpacked).toEqual(values);
    });

    it('pack then unpack returns original values for str', () => {
      const s = new StructUtil([
        { name: 'data', type: 'str', length: 5 },
      ]);
      const values = { data: new Uint8Array([10, 20, 30, 40, 50]) };
      const packed = s.pack(values);
      const unpacked = s.unpack(packed);
      expect(unpacked).not.toBeNull();
      expect(unpacked!['data']).toEqual(new Uint8Array([10, 20, 30, 40, 50]));
    });

    it('defaults to little-endian when no byte order specified', () => {
      const s = new StructUtil([{ name: 'val', type: 'int16' }]);
      const packed = s.pack({ val: 0x0102 });
      // Little-endian: low byte first
      expect(packed[0]).toBe(0x02);
      expect(packed[1]).toBe(0x01);
    });
  });
});
