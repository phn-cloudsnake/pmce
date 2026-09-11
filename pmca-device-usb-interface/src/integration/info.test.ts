/**
 * Integration test for the full PmcaDevice.info() flow.
 *
 * Uses MockUSBDevice to simulate the entire USB communication stack:
 * WebUsbBackend → MtpDriver → SonyExtCmdProtocol → SonyUpdaterProtocol → PmcaDevice.info()
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { describe, it, expect } from 'vitest';
import { MockUSBDevice, asMockDevice } from '../test-utils/index.js';
import { WebUsbBackend } from '../transport/web-usb-backend.js';
import { PmcaDevice } from '../pmca-device.js';
import { StructUtil } from '../utils/struct-util.js';
import {
  PTP_HEADER_SIZE,
  PTP_TYPE_DATA,
  PTP_TYPE_RESPONSE,
  PTP_RC_OK,
  EXTCMD_HEADER_SIZE,
  GPS_EPOCH,
} from '../constants.js';

// ===========================================================================
// Helpers for building mock PTP response packets
// ===========================================================================

const PtpHeaderStruct = new StructUtil([
  { name: 'size', type: 'int32' },
  { name: 'type', type: 'int16' },
  { name: 'code', type: 'int16' },
  { name: 'transaction', type: 'int32' },
]);

const ExtCmdHeaderStruct = new StructUtil([
  { name: 'dataSize', type: 'int32' },
  { name: 'cmd', type: 'int16' },
  { name: 'direction', type: 'int16' },
  { name: 'reserved', type: 'str', length: 8 },
]);

const UpdaterPacketHeaderStruct = new StructUtil([
  { name: 'bodySize', type: 'int32' },
  { name: 'protocolVersion', type: 'int16' },
  { name: 'commandId', type: 'int16' },
  { name: 'responseId', type: 'int16' },
  { name: 'sequenceNumber', type: 'int16' },
  { name: 'reserved', type: 'str', length: 20 },
]);

const QueryVersionResponseStruct = new StructUtil([
  { name: 'oldFirmMinorVersion', type: 'int16' },
  { name: 'oldFirmMajorVersion', type: 'int16' },
  { name: 'newFirmMinorVersion', type: 'int16' },
  { name: 'newFirmMajorVersion', type: 'int16' },
]);

const MountedLensInfoStruct = new StructUtil([
  { name: 'type', type: 'int32' },
  { name: 'versionMinor', type: 'int8' },
  { name: 'versionMajor', type: 'int8' },
  { name: 'model', type: 'str', length: 4 },
  { name: 'region', type: 'str', length: 4 },
]);

const InitGpsResponseStruct = new StructUtil([
  { name: 'status', type: 'int16' },
  { name: 'firstDate', type: 'int32' },
  { name: 'lastDate', type: 'int32' },
]);

/**
 * Build a PTP RESPONSE packet (header-only, no data phase).
 */
function buildPtpResponse(transaction: number, code: number = PTP_RC_OK): Uint8Array {
  return PtpHeaderStruct.pack({
    size: PTP_HEADER_SIZE,
    type: PTP_TYPE_RESPONSE,
    code,
    transaction,
  });
}

/**
 * Build a PTP DATA packet wrapping ExtCmd response data.
 * The full packet is: PTP header + ExtCmd header + payload.
 */
function buildExtCmdDataPacket(
  transaction: number,
  payload: Uint8Array,
  code: number = 0x9281, // PTP_OC_SonyDiExtCmd_read
): Uint8Array {
  // Build ExtCmd header indicating the payload size
  const extCmdHeader = ExtCmdHeaderStruct.pack({
    dataSize: payload.length,
    cmd: 0,
    direction: 2, // read direction
    reserved: new Uint8Array(8),
  });

  const totalDataLen = EXTCMD_HEADER_SIZE + payload.length;
  const ptpHeader = PtpHeaderStruct.pack({
    size: PTP_HEADER_SIZE + totalDataLen,
    type: PTP_TYPE_DATA,
    code,
    transaction,
  });

  const packet = new Uint8Array(PTP_HEADER_SIZE + totalDataLen);
  packet.set(ptpHeader, 0);
  packet.set(extCmdHeader, PTP_HEADER_SIZE);
  packet.set(payload, PTP_HEADER_SIZE + EXTCMD_HEADER_SIZE);
  return packet;
}

/**
 * Build an updater response wrapped inside ExtCmd data.
 * The structure is: PTP DATA[ExtCmd header + Updater header + body]
 */
function buildUpdaterResponsePacket(
  transaction: number,
  body: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const updaterHeader = UpdaterPacketHeaderStruct.pack({
    bodySize: body.length,
    protocolVersion: 0x100,
    commandId: 0,
    responseId: 1, // UPDATER_ERR_OK
    sequenceNumber: 0,
    reserved: new Uint8Array(20),
  });

  const updaterPayload = new Uint8Array(updaterHeader.length + body.length);
  updaterPayload.set(updaterHeader, 0);
  updaterPayload.set(body, updaterHeader.length);

  return buildExtCmdDataPacket(transaction, updaterPayload);
}

/**
 * Build the model info payload as returned by ExtCmd group 1, cmd 1.
 *
 * Binary format:
 * - 4 bytes: plistSize (uint32 LE)
 * - plistSize bytes: plistData
 * - 4 bytes: padding/unknown
 * - 1 byte: modelNameSize (uint8)
 * - modelNameSize bytes: model name (latin1)
 * - 5 bytes: model code (raw bytes, hex-encoded by parser)
 * - 4 bytes: serial number (raw bytes, hex-encoded by parser)
 */
function buildModelInfoPayload(options: {
  modelName: string;
  modelCode: Uint8Array; // 5 bytes
  serialNumber: Uint8Array; // 4 bytes
  plistData: Uint8Array;
}): Uint8Array {
  const { modelName, modelCode, serialNumber, plistData } = options;
  const nameBytes = new TextEncoder().encode(modelName);

  // Total size: 4 (plistSize) + plistData.length + 4 (padding) + 1 (nameSize) + name + 5 (code) + 4 (serial)
  const totalSize = 4 + plistData.length + 4 + 1 + nameBytes.length + 5 + 4;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const arr = new Uint8Array(buffer);
  let offset = 0;

  // plistSize
  view.setUint32(offset, plistData.length, true);
  offset += 4;

  // plistData
  arr.set(plistData, offset);
  offset += plistData.length;

  // padding (4 bytes of zeros)
  offset += 4;

  // modelNameSize
  view.setUint8(offset, nameBytes.length);
  offset += 1;

  // modelName
  arr.set(nameBytes, offset);
  offset += nameBytes.length;

  // modelCode (5 bytes)
  arr.set(modelCode, offset);
  offset += 5;

  // serialNumber (4 bytes)
  arr.set(serialNumber, offset);

  return arr;
}

/**
 * Queue the full set of responses for one ExtCmd sendCommand call.
 * Each call involves:
 *   - write phase: host sends COMMAND + DATA, expects RESPONSE (OK)
 *   - read phase: host sends COMMAND, expects DATA + RESPONSE (OK)
 *
 * So we need to queue: 1 response (write), 1 data + 1 response (read)
 */
function queueExtCmdResponses(
  mock: MockUSBDevice,
  transaction: number,
  responsePayload: Uint8Array,
): void {
  // Write phase response (PTP RESPONSE OK)
  mock.queueResponse(buildPtpResponse(transaction));

  // Read phase: DATA packet with ExtCmd-wrapped payload
  mock.queueResponse(buildExtCmdDataPacket(transaction + 1, responsePayload));

  // Read phase: RESPONSE OK
  mock.queueResponse(buildPtpResponse(transaction + 1));
}

/**
 * Queue responses for an updater command (which goes through ExtCmd).
 */
function queueUpdaterResponses(
  mock: MockUSBDevice,
  transaction: number,
  body: Uint8Array = new Uint8Array(0),
): void {
  // Write phase response
  mock.queueResponse(buildPtpResponse(transaction));

  // Read phase: updater response wrapped in ExtCmd DATA
  mock.queueResponse(buildUpdaterResponsePacket(transaction + 1, body));

  // Read phase: RESPONSE OK
  mock.queueResponse(buildPtpResponse(transaction + 1));
}

// ===========================================================================
// Test suite
// ===========================================================================

describe('PmcaDevice.info() integration', () => {
  it('returns complete CameraInfo with model, firmware, lens, and GPS data', async () => {
    const mock = new MockUSBDevice();
    const device = asMockDevice(mock);

    // Create and open backend
    const backend = new WebUsbBackend(device);
    await backend.open();

    // =========================================================================
    // Queue all mock responses in order
    // =========================================================================

    // Transaction IDs: MtpDriver starts at 0, increments for each command.
    // Each ExtCmd sendCommand uses 2 transactions (write + read).
    let txn = 0;

    // --- 1. Model info (ExtCmd group 1, cmd 1) ---
    const plistData = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
    const modelInfoPayload = buildModelInfoPayload({
      modelName: 'ILCE-6000',
      modelCode: new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89]),
      serialNumber: new Uint8Array([0xAB, 0xCD, 0xEF, 0x01]),
      plistData,
    });
    queueExtCmdResponses(mock, txn, modelInfoPayload);
    txn += 2;

    // --- 2. Updater init (CMD_INIT = 0x1) ---
    queueUpdaterResponses(mock, txn);
    txn += 2;

    // --- 3. Updater queryVersion (CMD_QUERY_VERSION = 0x20) ---
    const versionBody = QueryVersionResponseStruct.pack({
      oldFirmMinorVersion: 0x10, // minor = 0x10
      oldFirmMajorVersion: 3,    // major = 3 → "3.10"
      newFirmMinorVersion: 0x00,
      newFirmMajorVersion: 0,
    });
    queueUpdaterResponses(mock, txn, versionBody);
    txn += 2;

    // --- 4. Lens info (ExtCmd group 6, cmd 2) ---
    // Build a lens info struct: type=1, versionMinor=0x05, versionMajor=2, model=[0x12,0x34,0x56,0x78], region=[0,0,0,0]
    const lensPayload = MountedLensInfoStruct.pack({
      type: 1,
      versionMinor: 0x05,
      versionMajor: 2,
      model: new Uint8Array([0x12, 0x34, 0x56, 0x78]),
      region: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
    });
    queueExtCmdResponses(mock, txn, lensPayload);
    txn += 2;

    // --- 5. GPS data (ExtCmd group 3, cmd 1) ---
    // GPS timestamps: hours since Jan 6, 1980
    const firstDateHours = 24 * 365; // ~1 year worth of hours
    const lastDateHours = 24 * 365 * 2; // ~2 years
    const gpsPayload = InitGpsResponseStruct.pack({
      status: 0,
      firstDate: firstDateHours,
      lastDate: lastDateHours,
    });
    queueExtCmdResponses(mock, txn, gpsPayload);

    // =========================================================================
    // Execute info() and verify
    // =========================================================================

    const pmca = new PmcaDevice(backend);
    const info = await pmca.info();

    // Requirement 4.1: modelName, modelCode, serialNumber, plistData
    expect(info.modelName).toBe('ILCE-6000');
    expect(info.modelCode).toBe('0123456789');
    expect(info.serialNumber).toBe('abcdef01');
    expect(info.plistData).toEqual(plistData);

    // Requirement 4.2 & 4.3: firmware version formatted as "%x.%02x"
    expect(info.firmwareVersion).toBe('3.10');

    // Requirement 4.4: lens model and lens firmware version
    // Lens model bytes [0x12, 0x34, 0x56, 0x78]:
    // Python logic: model[0:2] + model[3:4] + model[2:3] → bytes [0x12, 0x34, 0x78, 0x56]
    // As big-endian uint32: (0x12 << 24) | (0x34 << 16) | (0x78 << 8) | 0x56 = 0x12347856
    expect(info.lensModel).toBe('0x12347856');
    expect(info.lensFirmwareVersion).toBe('2.05');

    // Requirement 4.5: GPS data range
    expect(info.gpsDataRange).toBeDefined();
    const expectedStart = new Date(
      GPS_EPOCH.getTime() + (firstDateHours & 0xffffff) * 60 * 60 * 1000,
    );
    // End date adds 6 additional hours
    const expectedEnd = new Date(
      GPS_EPOCH.getTime() + ((lastDateHours & 0xffffff) + 6) * 60 * 60 * 1000,
    );
    expect(info.gpsDataRange!.start.getTime()).toBe(expectedStart.getTime());
    expect(info.gpsDataRange!.end.getTime()).toBe(expectedEnd.getTime());
  });

  it('omits lens info when ExtCmd group 6 is not supported (Requirement 4.6)', async () => {
    const mock = new MockUSBDevice();
    const device = asMockDevice(mock);

    const backend = new WebUsbBackend(device);
    await backend.open();

    let txn = 0;

    // --- 1. Model info ---
    const plistData = new Uint8Array([0x01, 0x02]);
    const modelInfoPayload = buildModelInfoPayload({
      modelName: 'DSC-RX100',
      modelCode: new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0xEE]),
      serialNumber: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
      plistData,
    });
    queueExtCmdResponses(mock, txn, modelInfoPayload);
    txn += 2;

    // --- 2. Updater init ---
    queueUpdaterResponses(mock, txn);
    txn += 2;

    // --- 3. Updater queryVersion ---
    const versionBody = QueryVersionResponseStruct.pack({
      oldFirmMinorVersion: 0x01,
      oldFirmMajorVersion: 1,
      newFirmMinorVersion: 0x00,
      newFirmMajorVersion: 0,
    });
    queueUpdaterResponses(mock, txn, versionBody);
    txn += 2;

    // --- 4. Lens info: return ParameterNotSupported (0x2006) on write phase ---
    // This triggers InvalidCommandError, which info() should catch
    const PTP_RC_ParameterNotSupported = 0x2006;
    mock.queueResponse(buildPtpResponse(txn, PTP_RC_ParameterNotSupported));
    txn += 1;

    // --- 5. GPS data: also not supported ---
    mock.queueResponse(buildPtpResponse(txn, PTP_RC_ParameterNotSupported));

    // =========================================================================
    // Execute info() and verify graceful degradation
    // =========================================================================

    const pmca = new PmcaDevice(backend);
    const info = await pmca.info();

    // Model info should still be present
    expect(info.modelName).toBe('DSC-RX100');
    expect(info.modelCode).toBe('aabbccddee');
    expect(info.serialNumber).toBe('11223344');
    expect(info.firmwareVersion).toBe('1.01');

    // Lens and GPS should be omitted (not throw)
    expect(info.lensModel).toBeUndefined();
    expect(info.lensFirmwareVersion).toBeUndefined();
    expect(info.gpsDataRange).toBeUndefined();
  });

  it('omits lens info when lens model value is 0 (no lens mounted)', async () => {
    const mock = new MockUSBDevice();
    const device = asMockDevice(mock);

    const backend = new WebUsbBackend(device);
    await backend.open();

    let txn = 0;

    // --- 1. Model info ---
    const plistData = new Uint8Array([0xFF]);
    const modelInfoPayload = buildModelInfoPayload({
      modelName: 'ILCE-7M3',
      modelCode: new Uint8Array([0x05, 0x06, 0x07, 0x08, 0x09]),
      serialNumber: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
      plistData,
    });
    queueExtCmdResponses(mock, txn, modelInfoPayload);
    txn += 2;

    // --- 2. Updater init ---
    queueUpdaterResponses(mock, txn);
    txn += 2;

    // --- 3. Updater queryVersion ---
    const versionBody = QueryVersionResponseStruct.pack({
      oldFirmMinorVersion: 0x00,
      oldFirmMajorVersion: 4,
      newFirmMinorVersion: 0x00,
      newFirmMajorVersion: 0,
    });
    queueUpdaterResponses(mock, txn, versionBody);
    txn += 2;

    // --- 4. Lens info: command succeeds but model is all zeros (no lens) ---
    const noLensPayload = MountedLensInfoStruct.pack({
      type: 0,
      versionMinor: 0,
      versionMajor: 0,
      model: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
      region: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
    });
    queueExtCmdResponses(mock, txn, noLensPayload);
    txn += 2;

    // --- 5. GPS data ---
    const gpsPayload = InitGpsResponseStruct.pack({
      status: 0,
      firstDate: 100,
      lastDate: 200,
    });
    queueExtCmdResponses(mock, txn, gpsPayload);

    // =========================================================================
    // Execute info() and verify
    // =========================================================================

    const pmca = new PmcaDevice(backend);
    const info = await pmca.info();

    expect(info.modelName).toBe('ILCE-7M3');
    expect(info.firmwareVersion).toBe('4.00');

    // Lens fields should be undefined (model is 0)
    expect(info.lensModel).toBeUndefined();
    expect(info.lensFirmwareVersion).toBeUndefined();

    // GPS should be present
    expect(info.gpsDataRange).toBeDefined();
    const expectedStart = new Date(GPS_EPOCH.getTime() + 100 * 60 * 60 * 1000);
    const expectedEnd = new Date(GPS_EPOCH.getTime() + (200 + 6) * 60 * 60 * 1000);
    expect(info.gpsDataRange!.start.getTime()).toBe(expectedStart.getTime());
    expect(info.gpsDataRange!.end.getTime()).toBe(expectedEnd.getTime());
  });
});
