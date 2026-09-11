import { describe, it, expect } from 'vitest';
import { SpkCodec } from './spk-codec';
import { FormatError } from '../errors';

describe('SpkCodec', () => {
  describe('parseContainer', () => {
    it('should throw FormatError on data shorter than 12 bytes', () => {
      expect(() => SpkCodec.parseContainer(new Uint8Array(7))).toThrow(
        FormatError,
      );
    });

    it('should throw FormatError on invalid magic', () => {
      const data = new Uint8Array(20);
      data.set([0x00, 0x00, 0x00, 0x00], 0); // wrong magic
      expect(() => SpkCodec.parseContainer(data)).toThrow(FormatError);
    });

    it('should parse a valid SPK container', () => {
      // Build a minimal SPK: magic "1spk" + keyOffset=0 + keySize=4 + 4 key bytes + 2 data bytes
      const container = new Uint8Array(18);
      const view = new DataView(container.buffer);
      // Magic "1spk"
      container.set([0x31, 0x73, 0x70, 0x6b], 0);
      // keyOffset = 0
      view.setUint32(4, 0, true);
      // keySize = 4
      view.setUint32(8, 4, true);
      // Key bytes
      container.set([0xaa, 0xbb, 0xcc, 0xdd], 12);
      // Data bytes
      container.set([0xee, 0xff], 16);

      const { encryptedKey, encryptedData } = SpkCodec.parseContainer(container);
      expect(encryptedKey).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
      expect(encryptedData).toEqual(new Uint8Array([0xee, 0xff]));
    });

    it('should throw FormatError if data is too short for declared key size', () => {
      const container = new Uint8Array(12);
      const view = new DataView(container.buffer);
      container.set([0x31, 0x73, 0x70, 0x6b], 0);
      view.setUint32(4, 0, true);
      view.setUint32(8, 256, true); // keySize=256 but only 12 bytes total
      expect(() => SpkCodec.parseContainer(container)).toThrow(FormatError);
    });
  });

  describe('buildContainer', () => {
    it('should build a valid SPK container', () => {
      const key = new Uint8Array([0x01, 0x02, 0x03]);
      const data = new Uint8Array([0x04, 0x05]);

      const container = SpkCodec.buildContainer(key, data);
      // Header: 12 bytes + key: 3 bytes + data: 2 bytes = 17
      expect(container.length).toBe(17);

      // Verify magic
      expect(container[0]).toBe(0x31); // '1'
      expect(container[1]).toBe(0x73); // 's'
      expect(container[2]).toBe(0x70); // 'p'
      expect(container[3]).toBe(0x6b); // 'k'

      // Verify keyOffset = 0
      const view = new DataView(container.buffer, container.byteOffset);
      expect(view.getUint32(4, true)).toBe(0);
      // Verify keySize = 3
      expect(view.getUint32(8, true)).toBe(3);
      // Verify key
      expect(container.slice(12, 15)).toEqual(key);
      // Verify data
      expect(container.slice(15, 17)).toEqual(data);
    });
  });

  describe('buildContainer + parseContainer round-trip', () => {
    it('should round-trip correctly', () => {
      const key = new Uint8Array(256).fill(0x42);
      const data = new Uint8Array(1024).fill(0x7f);

      const container = SpkCodec.buildContainer(key, data);
      const parsed = SpkCodec.parseContainer(container);

      expect(parsed.encryptedKey).toEqual(key);
      expect(parsed.encryptedData).toEqual(data);
    });
  });

  describe('decryptKey', () => {
    it('should return a non-empty key from the sample SPK key blob', async () => {
      // Use the SAMPLE_SPK_KEY indirectly via apkToSpk which calls decryptKey
      // We can't access the private constant, but we can test via the full flow.
      // Instead, let's just verify decryptKey doesn't throw and returns bytes.
      const sampleKey = new Uint8Array([
        0x7e, 0x29, 0x35, 0x14, 0x25, 0xec, 0x82, 0xc6, 0x1e, 0xf1, 0xd7,
        0x36, 0xaf, 0xad, 0xc2, 0x80, 0x96, 0x6a, 0x2d, 0xad, 0xd5, 0x3f,
        0xfe, 0xe3, 0xd5, 0x5e, 0x60, 0x8a, 0xfa, 0xd4, 0x39, 0x51, 0x85,
        0x3a, 0x1b, 0xe9, 0xe3, 0x62, 0x65, 0xb0, 0x5c, 0x1e, 0x43, 0x45,
        0xac, 0x49, 0x19, 0xd6, 0xc9, 0xef, 0x4e, 0x02, 0x1f, 0x58, 0xbf,
        0x85, 0xe4, 0x85, 0x1c, 0x3c, 0xb2, 0xbd, 0x14, 0x41, 0x6d, 0x26,
        0x15, 0x26, 0x29, 0x65, 0x23, 0x25, 0x96, 0x64, 0xbe, 0x8a, 0xc2,
        0x47, 0x7f, 0x7b, 0xd6, 0xd1, 0xc1, 0x62, 0xaf, 0x28, 0x6c, 0x65,
        0xa7, 0xf5, 0x7a, 0x18, 0x00, 0xe4, 0x89, 0xcf, 0x24, 0xfc, 0x58,
        0xfb, 0x04, 0x1f, 0x29, 0xea, 0x10, 0x3f, 0x5f, 0xca, 0x3e, 0xb9,
        0x96, 0xba, 0xaf, 0x8e, 0xea, 0x2c, 0xfd, 0x64, 0x31, 0xbb, 0x76,
        0x5d, 0xce, 0xd8, 0x11, 0x0b, 0x34, 0x1d, 0xb6, 0xd3, 0x13, 0xdc,
        0x40, 0xa8, 0x2a, 0x6e, 0x21, 0x34, 0x27, 0x2e, 0x3a, 0xa3, 0xc7,
        0x57, 0x0b, 0x80, 0xd5, 0xd1, 0xd7, 0x53, 0x3f, 0x2e, 0xfc, 0xf3,
        0xff, 0x0a, 0x00, 0xf9, 0x16, 0x91, 0x84, 0x74, 0x17, 0x00, 0x5d,
        0xa8, 0x41, 0xfd, 0x29, 0x06, 0xac, 0x7e, 0x07, 0x67, 0xfa, 0xfb,
        0xbb, 0x1e, 0x7e, 0xa0, 0xe1, 0xc7, 0x68, 0x28, 0xac, 0xe6, 0x6f,
        0xdd, 0x44, 0x95, 0x06, 0x60, 0x9c, 0xc6, 0x04, 0xc8, 0xab, 0xf1,
        0x1d, 0x94, 0x14, 0xa7, 0xcb, 0x29, 0x6d, 0x93, 0x84, 0x1b, 0x3a,
        0x06, 0x2c, 0x05, 0xe5, 0xa3, 0xf3, 0x40, 0x55, 0x6d, 0xc2, 0x5e,
        0x6c, 0x0e, 0x46, 0x74, 0x66, 0x24, 0x2f, 0xf4, 0x33, 0xcc, 0x20,
        0x0e, 0xf9, 0xf2, 0x9d, 0x9b, 0xbd, 0xf6, 0x22, 0x72, 0x12, 0xef,
        0x40, 0xbc, 0x43, 0xcb, 0x74, 0xb1, 0xdf, 0x02, 0xbe, 0x31, 0x53,
        0xa3, 0x34, 0xa2,
      ]);

      const aesKey = await SpkCodec.decryptKey(sampleKey);
      expect(aesKey.length).toBeGreaterThan(0);
      expect(aesKey.length).toBeLessThanOrEqual(16);
    });
  });

  describe('apkToSpk / spkToApk round-trip', () => {
    it('should round-trip small data correctly', async () => {
      const apk = new Uint8Array(32);
      for (let i = 0; i < 32; i++) apk[i] = i;

      const spk = await SpkCodec.apkToSpk(apk);
      const result = await SpkCodec.spkToApk(spk);
      expect(result).toEqual(apk);
    });

    it('should round-trip data exactly 1 MB (one full block)', async () => {
      const apk = new Uint8Array(0x100000);
      for (let i = 0; i < apk.length; i++) apk[i] = i & 0xff;

      const spk = await SpkCodec.apkToSpk(apk);
      const result = await SpkCodec.spkToApk(spk);
      expect(result).toEqual(apk);
    });

    it('should round-trip data spanning multiple blocks', async () => {
      // 1MB + 100 bytes -> 2 blocks
      const apk = new Uint8Array(0x100000 + 100);
      for (let i = 0; i < apk.length; i++) apk[i] = (i * 7) & 0xff;

      const spk = await SpkCodec.apkToSpk(apk);
      const result = await SpkCodec.spkToApk(spk);
      expect(result).toEqual(apk);
    });

    it('should round-trip a single byte', async () => {
      const apk = new Uint8Array([0x42]);

      const spk = await SpkCodec.apkToSpk(apk);
      const result = await SpkCodec.spkToApk(spk);
      expect(result).toEqual(apk);
    });
  });

  describe('spkToApk error handling', () => {
    it('should throw FormatError on empty input', () => {
      expect(() => SpkCodec.parseContainer(new Uint8Array(0))).toThrow(
        FormatError,
      );
    });

    it('should throw FormatError on invalid magic', () => {
      const bad = new Uint8Array(268);
      bad.set([0x00, 0x00, 0x00, 0x00], 0); // wrong magic
      expect(() => SpkCodec.parseContainer(bad)).toThrow(FormatError);
    });
  });
});
