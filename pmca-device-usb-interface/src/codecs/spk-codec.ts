/**
 * SPK codec - handles conversion between APK and SPK (Sony Package) format.
 *
 * SPK format:
 *   4 bytes: magic "1spk"
 *   4 bytes: LE keyOffset (always 0)
 *   4 bytes: LE keySize
 *   [keySize bytes]: RSA-encrypted AES key
 *   [remaining bytes]: AES-ECB encrypted APK data (1MB blocks + PKCS#7 padding)
 */

import { SPK_MAGIC, SPK_BLOCK_SIZE, SPK_PADDING_SIZE } from '../constants';
import { FormatError } from '../errors';

// =============================================================================
// RSA Constants (from pmca/spk/constants.py — ScalarAInstaller.apk)
// =============================================================================

const RSA_MODULUS = BigInt(
  '18546786124031929736450043032989194943881708896956310049376885815353452452737129160084493534424259917885859685404970368509019605185259963806563452189947051455437552314477916953143062044204000233355686480383169448909078186398717520581109145341225470292554937903142958836844346971293647348222873983594916965142879437008833178868483114882377493704135238091195859303789511256231440821207663503100500629361938642335839866157113610679689132138679971646420026197437282015245989139338190682985702090970027710310551550127193083201786677858304822056545507776969720889751356415799936270667430411556285015304886252479659945984429',
);

const RSA_EXPONENT = BigInt(65537);

/**
 * Sample encrypted SPK key blob (256 bytes).
 * Taken from TouchLessShutter100.1.spk at offset 0x0C.
 * When decrypted with the known RSA public key, yields the 128-bit AES key.
 */
const SAMPLE_SPK_KEY = new Uint8Array([
  0x7e, 0x29, 0x35, 0x14, 0x25, 0xec, 0x82, 0xc6, 0x1e, 0xf1, 0xd7, 0x36,
  0xaf, 0xad, 0xc2, 0x80, 0x96, 0x6a, 0x2d, 0xad, 0xd5, 0x3f, 0xfe, 0xe3,
  0xd5, 0x5e, 0x60, 0x8a, 0xfa, 0xd4, 0x39, 0x51, 0x85, 0x3a, 0x1b, 0xe9,
  0xe3, 0x62, 0x65, 0xb0, 0x5c, 0x1e, 0x43, 0x45, 0xac, 0x49, 0x19, 0xd6,
  0xc9, 0xef, 0x4e, 0x02, 0x1f, 0x58, 0xbf, 0x85, 0xe4, 0x85, 0x1c, 0x3c,
  0xb2, 0xbd, 0x14, 0x41, 0x6d, 0x26, 0x15, 0x26, 0x29, 0x65, 0x23, 0x25,
  0x96, 0x64, 0xbe, 0x8a, 0xc2, 0x47, 0x7f, 0x7b, 0xd6, 0xd1, 0xc1, 0x62,
  0xaf, 0x28, 0x6c, 0x65, 0xa7, 0xf5, 0x7a, 0x18, 0x00, 0xe4, 0x89, 0xcf,
  0x24, 0xfc, 0x58, 0xfb, 0x04, 0x1f, 0x29, 0xea, 0x10, 0x3f, 0x5f, 0xca,
  0x3e, 0xb9, 0x96, 0xba, 0xaf, 0x8e, 0xea, 0x2c, 0xfd, 0x64, 0x31, 0xbb,
  0x76, 0x5d, 0xce, 0xd8, 0x11, 0x0b, 0x34, 0x1d, 0xb6, 0xd3, 0x13, 0xdc,
  0x40, 0xa8, 0x2a, 0x6e, 0x21, 0x34, 0x27, 0x2e, 0x3a, 0xa3, 0xc7, 0x57,
  0x0b, 0x80, 0xd5, 0xd1, 0xd7, 0x53, 0x3f, 0x2e, 0xfc, 0xf3, 0xff, 0x0a,
  0x00, 0xf9, 0x16, 0x91, 0x84, 0x74, 0x17, 0x00, 0x5d, 0xa8, 0x41, 0xfd,
  0x29, 0x06, 0xac, 0x7e, 0x07, 0x67, 0xfa, 0xfb, 0xbb, 0x1e, 0x7e, 0xa0,
  0xe1, 0xc7, 0x68, 0x28, 0xac, 0xe6, 0x6f, 0xdd, 0x44, 0x95, 0x06, 0x60,
  0x9c, 0xc6, 0x04, 0xc8, 0xab, 0xf1, 0x1d, 0x94, 0x14, 0xa7, 0xcb, 0x29,
  0x6d, 0x93, 0x84, 0x1b, 0x3a, 0x06, 0x2c, 0x05, 0xe5, 0xa3, 0xf3, 0x40,
  0x55, 0x6d, 0xc2, 0x5e, 0x6c, 0x0e, 0x46, 0x74, 0x66, 0x24, 0x2f, 0xf4,
  0x33, 0xcc, 0x20, 0x0e, 0xf9, 0xf2, 0x9d, 0x9b, 0xbd, 0xf6, 0x22, 0x72,
  0x12, 0xef, 0x40, 0xbc, 0x43, 0xcb, 0x74, 0xb1, 0xdf, 0x02, 0xbe, 0x31,
  0x53, 0xa3, 0x34, 0xa2,
]);

/** SPK header size: 4 (magic) + 4 (keyOffset) + 4 (keySize) = 12 bytes. */
const SPK_HEADER_SIZE = 12;

// =============================================================================
// BigInt ↔ Uint8Array helpers
// =============================================================================

/** Convert a Uint8Array (big-endian) to a BigInt. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result = (result << BigInt(8)) | BigInt(bytes[i]);
  }
  return result;
}

/** Convert a BigInt to a Uint8Array of the specified byte length (big-endian). */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(value & BigInt(0xff));
    value >>= BigInt(8);
  }
  return result;
}

/** Convert a BigInt to minimal-length Uint8Array (no leading zeros). */
function bigIntToMinimalBytes(value: bigint): Uint8Array {
  if (value === BigInt(0)) {
    return new Uint8Array([0]);
  }
  // Determine byte length
  let temp = value;
  let length = 0;
  while (temp > BigInt(0)) {
    temp >>= BigInt(8);
    length++;
  }
  return bigIntToBytes(value, length);
}

/** Modular exponentiation: (base ** exponent) mod modulus. */
function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = BigInt(1);
  base = base % modulus;
  while (exponent > BigInt(0)) {
    if (exponent & BigInt(1)) {
      result = (result * base) % modulus;
    }
    exponent >>= BigInt(1);
    base = (base * base) % modulus;
  }
  return result;
}

// =============================================================================
// PKCS#7 padding
// =============================================================================

/** Apply PKCS#7 padding to align data to SPK_PADDING_SIZE (16 bytes). */
function pkcs7Pad(data: Uint8Array): Uint8Array {
  const n = SPK_PADDING_SIZE - (data.length % SPK_PADDING_SIZE);
  const padded = new Uint8Array(data.length + n);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = n;
  }
  return padded;
}

/** Remove PKCS#7 padding from data. */
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    return data;
  }
  const n = data[data.length - 1];
  return data.slice(0, data.length - n);
}

// =============================================================================
// AES-ECB using Web Crypto (simulated via AES-CBC with zero IV, block-by-block)
// =============================================================================

/**
 * Encrypt data with AES-ECB.
 * Web Crypto does not support ECB directly, so we use AES-CBC with zero IV
 * and process one 16-byte block at a time.
 */
async function aesEcbEncrypt(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const keyBuffer = new ArrayBuffer(key.length);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );

  const zeroIv = new Uint8Array(16);
  const result = new Uint8Array(data.length);

  // Process 16 bytes at a time
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.slice(offset, offset + 16);
    // AES-CBC with zero IV on a single block is equivalent to AES-ECB on that block.
    // Web Crypto adds PKCS7 padding by default, so encrypted result is 32 bytes (16 + 16 padding).
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: zeroIv },
      cryptoKey,
      block,
    );
    // Take only the first 16 bytes (the actual encrypted block, ignore padding block).
    result.set(new Uint8Array(encrypted, 0, 16), offset);
  }

  return result;
}

/**
 * Decrypt data with AES-ECB.
 * Uses bulk CBC decryption with post-XOR correction to recover ECB output.
 */
async function aesEcbDecrypt(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const keyBuffer = new ArrayBuffer(key.length);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  );

  return aesEcbDecryptBulk(cryptoKey, data);
}

/**
 * Bulk AES-ECB decryption using CBC with post-XOR correction.
 * CBC decrypt: P_i = D(C_i) XOR C_{i-1}
 * ECB decrypt: P_i = D(C_i)
 * Therefore: ECB_P_i = CBC_P_i XOR C_{i-1} (for i > 0)
 *
 * To handle PKCS7 padding that Web Crypto requires, we append an extra
 * ciphertext block that produces valid PKCS7 padding when decrypted.
 * We encrypt a block of 0x10 bytes (valid PKCS7 for 16-byte block size) in ECB
 * via CBC to get the needed trailer block.
 */
async function aesEcbDecryptBulk(
  cryptoKey: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (data.length === 0) {
    return new Uint8Array(0);
  }

  const zeroIv = new Uint8Array(16);
  const numBlocks = data.length / 16;

  // Step 1: Create a padding block.
  // Encrypt 16 bytes of 0x10 (valid PKCS#7 for AES block) using CBC with the
  // last ciphertext block as IV. When CBC decrypts this appended block,
  // it will produce 16 bytes of 0x10 = valid PKCS#7 padding, so Web Crypto won't reject it.
  const paddingPlain = new Uint8Array(16).fill(0x10);
  const lastBlock = data.slice(data.length - 16);
  const paddingEncrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: lastBlock },
    cryptoKey,
    paddingPlain,
  );
  // encrypt returns 32 bytes (16 encrypted + 16 PKCS7 padding from Web Crypto); take first 16
  const paddingBlock = new Uint8Array(paddingEncrypted, 0, 16);

  // Step 2: Build extended ciphertext = [data | paddingBlock]
  const extended = new Uint8Array(data.length + 16);
  extended.set(data);
  extended.set(paddingBlock, data.length);

  // Step 3: Decrypt with CBC mode (zero IV). This gives us numBlocks+1 blocks of plaintext.
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: zeroIv },
    cryptoKey,
    extended,
  );
  // Web Crypto strips PKCS7 padding, so result is numBlocks * 16 bytes.
  const cbcPlaintext = new Uint8Array(decrypted);

  // Step 4: Convert CBC plaintext to ECB plaintext via XOR correction.
  // CBC: P_i = D(C_i) XOR C_{i-1}, IV is C_{-1} = zeros
  // ECB: P_i = D(C_i) = CBC_P_i XOR C_{i-1}
  // For i=0: C_{-1} = IV = zeros, so ECB_P_0 = CBC_P_0 XOR 0 = CBC_P_0
  // For i>0: ECB_P_i = CBC_P_i XOR C_{i-1} = CBC_P_i XOR data[(i-1)*16..i*16-1]
  const result = new Uint8Array(numBlocks * 16);
  // First block: no correction needed
  result.set(cbcPlaintext.slice(0, 16));
  // Subsequent blocks: XOR with previous ciphertext block
  for (let i = 1; i < numBlocks; i++) {
    const offset = i * 16;
    for (let j = 0; j < 16; j++) {
      result[offset + j] = cbcPlaintext[offset + j] ^ data[offset - 16 + j];
    }
  }

  return result;
}

// =============================================================================
// Chunk helper
// =============================================================================

/** Split data into chunks of the given size. */
function chunk(data: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.slice(i, i + size));
  }
  return chunks;
}

// =============================================================================
// SpkCodec class
// =============================================================================

/**
 * Encodes/decodes SPK (Sony Package) files.
 *
 * SPK files are encrypted APK containers used by Sony cameras for app installation.
 * The APK data is split into 1MB blocks, PKCS#7 padded, and AES-ECB encrypted.
 * The AES key itself is stored RSA-encrypted in the SPK header.
 */
export class SpkCodec {
  /**
   * Convert APK data to SPK format.
   *
   * Uses the hardcoded sample encrypted key blob (which yields a known AES key
   * when decrypted with the RSA public key).
   */
  static async apkToSpk(apkData: Uint8Array): Promise<Uint8Array> {
    const encryptedKey = SAMPLE_SPK_KEY;
    const key = await SpkCodec.decryptKey(encryptedKey);
    const encryptedData = await SpkCodec.encryptData(key, apkData);
    return SpkCodec.buildContainer(encryptedKey, encryptedData);
  }

  /**
   * Convert SPK data back to APK format.
   *
   * Verifies the SPK magic, parses the container, decrypts the AES key via RSA,
   * then decrypts the payload block by block.
   */
  static async spkToApk(spkData: Uint8Array): Promise<Uint8Array> {
    const { encryptedKey, encryptedData } = SpkCodec.parseContainer(spkData);
    const key = await SpkCodec.decryptKey(encryptedKey);
    return SpkCodec.decryptData(key, encryptedData);
  }

  /**
   * Parse an SPK container into its encrypted key and encrypted data components.
   *
   * @throws FormatError if magic is invalid or data is too short
   */
  static parseContainer(data: Uint8Array): {
    encryptedKey: Uint8Array;
    encryptedData: Uint8Array;
  } {
    if (data.length < SPK_HEADER_SIZE) {
      throw new FormatError(
        'SPK data too short to contain a valid header',
      );
    }

    // Verify magic "1spk"
    for (let i = 0; i < 4; i++) {
      if (data[i] !== SPK_MAGIC[i]) {
        throw new FormatError('Invalid SPK magic bytes');
      }
    }

    // Parse header fields (little-endian)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const keyOffset = view.getUint32(4, true);
    const keySize = view.getUint32(8, true);

    const keyStart = SPK_HEADER_SIZE + keyOffset;
    const dataStart = keyStart + keySize;

    if (data.length < dataStart) {
      throw new FormatError(
        'SPK data too short to contain the declared key',
      );
    }

    return {
      encryptedKey: data.slice(keyStart, keyStart + keySize),
      encryptedData: data.slice(dataStart),
    };
  }

  /**
   * Build an SPK container from encrypted key and encrypted data.
   */
  static buildContainer(
    encryptedKey: Uint8Array,
    encryptedData: Uint8Array,
  ): Uint8Array {
    const header = new Uint8Array(SPK_HEADER_SIZE);
    // Magic "1spk"
    header.set(SPK_MAGIC, 0);
    // keyOffset = 0 (LE)
    const headerView = new DataView(header.buffer);
    headerView.setUint32(4, 0, true);
    // keySize (LE)
    headerView.setUint32(8, encryptedKey.length, true);

    // Concatenate: header + encryptedKey + encryptedData
    const result = new Uint8Array(
      header.length + encryptedKey.length + encryptedData.length,
    );
    result.set(header, 0);
    result.set(encryptedKey, header.length);
    result.set(encryptedData, header.length + encryptedKey.length);
    return result;
  }

  /**
   * Decrypt an RSA-encrypted AES key using the known public key.
   *
   * Uses raw (textbook) RSA with BigInt since Web Crypto doesn't support
   * RSA without padding schemes. Returns the result with leading zeros stripped
   * (matching Python's long_to_bytes behavior).
   */
  static async decryptKey(encryptedKey: Uint8Array): Promise<Uint8Array> {
    const message = bytesToBigInt(encryptedKey);
    const decrypted = modPow(message, RSA_EXPONENT, RSA_MODULUS);
    return bigIntToMinimalBytes(decrypted);
  }

  /**
   * Encrypt APK data using AES-ECB.
   *
   * Splits data into 1MB blocks, applies PKCS#7 padding to each, then encrypts.
   */
  static async encryptData(
    key: Uint8Array,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    const blocks = chunk(data, SPK_BLOCK_SIZE);
    const encryptedBlocks: Uint8Array[] = [];

    for (const block of blocks) {
      const padded = pkcs7Pad(block);
      const encrypted = await aesEcbEncrypt(key, padded);
      encryptedBlocks.push(encrypted);
    }

    // Calculate total length and concatenate
    const totalLength = encryptedBlocks.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const block of encryptedBlocks) {
      result.set(block, offset);
      offset += block.length;
    }
    return result;
  }

  /**
   * Decrypt AES-ECB encrypted data.
   *
   * Splits data into chunks of (1MB + 16 bytes padding), decrypts each chunk,
   * then removes PKCS#7 padding from each decrypted chunk.
   */
  static async decryptData(
    key: Uint8Array,
    encryptedData: Uint8Array,
  ): Promise<Uint8Array> {
    const chunkSize = SPK_BLOCK_SIZE + SPK_PADDING_SIZE;
    const chunks = chunk(encryptedData, chunkSize);
    const decryptedBlocks: Uint8Array[] = [];

    for (const encChunk of chunks) {
      const decrypted = await aesEcbDecrypt(key, encChunk);
      const unpadded = pkcs7Unpad(decrypted);
      decryptedBlocks.push(unpadded);
    }

    // Calculate total length and concatenate
    const totalLength = decryptedBlocks.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const block of decryptedBlocks) {
      result.set(block, offset);
      offset += block.length;
    }
    return result;
  }
}
