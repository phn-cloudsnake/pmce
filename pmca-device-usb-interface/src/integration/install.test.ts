/**
 * Integration test for the SonyAppInstallProtocol layer.
 *
 * Tests the full message exchange sequence (sendInit, sendRequest,
 * sendSslData, sendEnd) by mocking the MtpDriver at the command level.
 * Verifies correct MTP operation codes (0x9488/0x9489/0x948c/0x948d)
 * and message framing.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonyAppInstallProtocol } from '../protocol/sony-app-install-protocol.js';
import {
  PTP_OC_GetProxyMessageInfo,
  PTP_OC_GetProxyMessage,
  PTP_OC_SendProxyMessageInfo,
  PTP_OC_SendProxyMessage,
  PTP_RC_OK,
} from '../constants.js';
import { StructUtil } from '../utils/struct-util.js';
import type { MtpDriver } from '../protocol/mtp-driver.js';

// =============================================================================
// Message constants (matching the protocol implementation)
// =============================================================================

const INFO_MSG_HEADER_MAGIC = 0xb481;

const SONY_MSG_Common = 0;
const SONY_MSG_Tcp = 1;
const SONY_MSG_Rest = 2;

const SONY_MSG_Common_Hello = 0x401;
const SONY_MSG_Tcp_ProxyData = 0x503;
const SONY_MSG_Rest_In = 0;

// =============================================================================
// Struct definitions for building mock responses
// =============================================================================

const InfoMsgHeaderStruct = new StructUtil([
  { name: 'flags', type: 'int32' },
  { name: 'magic', type: 'int16' },
  { name: 'reserved1', type: 'int16' },
  { name: 'dataSize', type: 'int32' },
  { name: 'reserved2', type: 'int16' },
  { name: 'padding', type: 'str', length: 42 },
], 'little-endian');

const CommonMsgHeaderStruct = new StructUtil([
  { name: 'version', type: 'int16' },
  { name: 'type', type: 'int32' },
  { name: 'size', type: 'int32' },
  { name: 'padding', type: 'str', length: 6 },
], 'big-endian');

const ProtocolMsgHeaderStruct = new StructUtil([
  { name: 'numProtocols', type: 'int32' },
], 'big-endian');

const ProtocolMsgProtoStruct = new StructUtil([
  { name: 'name', type: 'str', length: 4 },
  { name: 'id', type: 'int16' },
], 'big-endian');

const RestMsgHeaderStruct = new StructUtil([
  { name: 'type', type: 'int16' },
  { name: 'size', type: 'int16' },
], 'big-endian');

// =============================================================================
// Helper: build a framed camera response message
// =============================================================================

/**
 * Build a raw message as the camera would send it (2-byte type prefix + payload).
 */
function buildCameraMessage(msgType: number, payload: Uint8Array): Uint8Array {
  const message = new Uint8Array(2 + payload.length);
  const view = new DataView(message.buffer);
  view.setUint16(0, msgType, false); // big-endian
  message.set(payload, 2);
  return message;
}

/**
 * Build the info header response that tells us the data size.
 */
function buildInfoResponse(dataSize: number): Uint8Array {
  return InfoMsgHeaderStruct.pack({
    flags: 0,
    magic: INFO_MSG_HEADER_MAGIC,
    reserved1: 0,
    dataSize,
    reserved2: 0,
    padding: new Uint8Array(42),
  });
}

/**
 * Build a Common Hello (init response) message with protocol list.
 */
function buildHelloResponse(protocols: Array<{ name: string; id: number }>): Uint8Array {
  // Protocol entries payload
  const protoHeader = ProtocolMsgHeaderStruct.pack({ numProtocols: protocols.length });
  const protoEntries = protocols.map((p) =>
    ProtocolMsgProtoStruct.pack({
      name: new TextEncoder().encode(p.name),
      id: p.id,
    }),
  );
  const protoData = new Uint8Array(
    protoHeader.length + protoEntries.reduce((sum, e) => sum + e.length, 0),
  );
  protoData.set(protoHeader, 0);
  let offset = protoHeader.length;
  for (const entry of protoEntries) {
    protoData.set(entry, offset);
    offset += entry.length;
  }

  // Wrap in CommonMsgHeader
  const totalSize = CommonMsgHeaderStruct.size + protoData.length;
  const header = CommonMsgHeaderStruct.pack({
    version: 1,
    type: SONY_MSG_Common_Hello,
    size: totalSize,
    padding: new Uint8Array(6),
  });
  const commonPayload = new Uint8Array(totalSize);
  commonPayload.set(header, 0);
  commonPayload.set(protoData, CommonMsgHeaderStruct.size);

  // Wrap in top-level message (type prefix + payload)
  return buildCameraMessage(SONY_MSG_Common, commonPayload);
}

/**
 * Build a REST response message from the camera.
 */
function buildRestResponse(responseData: Uint8Array): Uint8Array {
  const restHeader = RestMsgHeaderStruct.pack({
    type: 2, // Rest_Out (response from camera)
    size: responseData.length,
  });
  const restPayload = new Uint8Array(restHeader.length + responseData.length);
  restPayload.set(restHeader, 0);
  restPayload.set(responseData, restHeader.length);

  return buildCameraMessage(SONY_MSG_Rest, restPayload);
}

// =============================================================================
// Mock MtpDriver
// =============================================================================

interface MockCall {
  method: 'sendWriteCommand' | 'sendReadCommand';
  code: number;
  args: number[];
  data?: Uint8Array;
}

/**
 * Creates a mock MtpDriver that records all calls and returns pre-configured responses.
 *
 * The mock simulates the camera's message exchange:
 * - sendWriteCommand calls for SendProxyMessageInfo/SendProxyMessage always return OK
 * - sendReadCommand calls for GetProxyMessageInfo/GetProxyMessage return queued responses
 */
function createMockMtpDriver(readResponses: Array<{ responseCode: number; data: Uint8Array }>) {
  const calls: MockCall[] = [];
  let readIndex = 0;

  const mockDriver = {
    sendWriteCommand: vi.fn(async (code: number, args: number[], data: Uint8Array) => {
      calls.push({ method: 'sendWriteCommand', code, args, data: new Uint8Array(data) });
      return PTP_RC_OK;
    }),
    sendReadCommand: vi.fn(async (code: number, args: number[]) => {
      calls.push({ method: 'sendReadCommand', code, args });
      const response = readResponses[readIndex];
      if (!response) {
        throw new Error(`No more read responses queued (index ${readIndex})`);
      }
      readIndex++;
      return response;
    }),
    get calls() { return calls; },
  } as unknown as MtpDriver & { calls: MockCall[] };

  return mockDriver;
}

// =============================================================================
// Tests
// =============================================================================

describe('SonyAppInstallProtocol integration', () => {
  describe('sendInit() sequence', () => {
    it('sends init message and receives protocol list', async () => {
      const helloMsg = buildHelloResponse([
        { name: 'TCPT', id: 0x01 },
        { name: 'REST', id: 0x100 },
      ]);

      const infoResponse = buildInfoResponse(helloMsg.length);

      const driver = createMockMtpDriver([
        // Response to GetProxyMessageInfo (for receiving init response)
        { responseCode: PTP_RC_OK, data: infoResponse },
        // Response to GetProxyMessage (actual hello message)
        { responseCode: PTP_RC_OK, data: helloMsg },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      const protocols = await protocol.sendInit();

      // Verify returned protocols
      expect(protocols).toHaveLength(2);
      expect(protocols[0]).toEqual({ name: 'TCPT', id: 0x01 });
      expect(protocols[1]).toEqual({ name: 'REST', id: 0x100 });

      // Verify correct MTP operation codes were used
      const writeCalls = driver.calls.filter(c => c.method === 'sendWriteCommand');
      const readCalls = driver.calls.filter(c => c.method === 'sendReadCommand');

      // sendInit sends: SendProxyMessageInfo + SendProxyMessage (the init message)
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[0].code).toBe(PTP_OC_SendProxyMessageInfo); // 0x948c
      expect(writeCalls[1].code).toBe(PTP_OC_SendProxyMessage);     // 0x948d

      // Then reads: GetProxyMessageInfo + GetProxyMessage (the hello response)
      expect(readCalls).toHaveLength(2);
      expect(readCalls[0].code).toBe(PTP_OC_GetProxyMessageInfo);   // 0x9488
      expect(readCalls[1].code).toBe(PTP_OC_GetProxyMessage);       // 0x9489
    });

    it('uses correct info header framing with magic 0xb481', async () => {
      const helloMsg = buildHelloResponse([{ name: 'TCPT', id: 0x01 }]);
      const infoResponse = buildInfoResponse(helloMsg.length);

      const driver = createMockMtpDriver([
        { responseCode: PTP_RC_OK, data: infoResponse },
        { responseCode: PTP_RC_OK, data: helloMsg },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendInit();

      // Check the info header sent via SendProxyMessageInfo
      const infoCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessageInfo,
      );
      expect(infoCall).toBeDefined();
      expect(infoCall!.data).toBeDefined();

      // Parse the sent info header to verify magic and data size
      const sentInfo = InfoMsgHeaderStruct.unpack(infoCall!.data!);
      expect(sentInfo).not.toBeNull();
      expect(sentInfo!['magic']).toBe(INFO_MSG_HEADER_MAGIC);
      expect(sentInfo!['dataSize']).toBeGreaterThan(0);
    });

    it('sends message with Common type prefix (0x0000)', async () => {
      const helloMsg = buildHelloResponse([{ name: 'TCPT', id: 0x01 }]);
      const infoResponse = buildInfoResponse(helloMsg.length);

      const driver = createMockMtpDriver([
        { responseCode: PTP_RC_OK, data: infoResponse },
        { responseCode: PTP_RC_OK, data: helloMsg },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendInit();

      // The actual message sent via SendProxyMessage should start with 2-byte type
      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      expect(msgCall).toBeDefined();
      expect(msgCall!.data).toBeDefined();

      // First 2 bytes = message type (big-endian), should be SONY_MSG_Common = 0
      const view = new DataView(
        msgCall!.data!.buffer,
        msgCall!.data!.byteOffset,
        msgCall!.data!.byteLength,
      );
      expect(view.getUint16(0, false)).toBe(SONY_MSG_Common);
    });
  });

  describe('sendRequest() sequence', () => {
    it('sends REST request and receives REST response', async () => {
      const requestData = new TextEncoder().encode('{"method":"getStatus"}');
      const responsePayload = new TextEncoder().encode('{"status":"ok"}');
      const restResponse = buildRestResponse(responsePayload);
      const infoResponse = buildInfoResponse(restResponse.length);

      const driver = createMockMtpDriver([
        // Response to GetProxyMessageInfo (for receiving REST response)
        { responseCode: PTP_RC_OK, data: infoResponse },
        // Response to GetProxyMessage (actual REST response)
        { responseCode: PTP_RC_OK, data: restResponse },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      const result = await protocol.sendRequest(requestData);

      // Verify response data
      expect(new TextDecoder().decode(result)).toBe('{"status":"ok"}');

      // Verify correct operation codes
      const writeCalls = driver.calls.filter(c => c.method === 'sendWriteCommand');
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[0].code).toBe(PTP_OC_SendProxyMessageInfo); // 0x948c
      expect(writeCalls[1].code).toBe(PTP_OC_SendProxyMessage);     // 0x948d

      const readCalls = driver.calls.filter(c => c.method === 'sendReadCommand');
      expect(readCalls).toHaveLength(2);
      expect(readCalls[0].code).toBe(PTP_OC_GetProxyMessageInfo);   // 0x9488
      expect(readCalls[1].code).toBe(PTP_OC_GetProxyMessage);       // 0x9489
    });

    it('sends message with REST type prefix (0x0002)', async () => {
      const requestData = new TextEncoder().encode('test');
      const responsePayload = new TextEncoder().encode('ok');
      const restResponse = buildRestResponse(responsePayload);
      const infoResponse = buildInfoResponse(restResponse.length);

      const driver = createMockMtpDriver([
        { responseCode: PTP_RC_OK, data: infoResponse },
        { responseCode: PTP_RC_OK, data: restResponse },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendRequest(requestData);

      // The message sent should have REST type prefix (0x0002)
      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      expect(msgCall).toBeDefined();

      const view = new DataView(
        msgCall!.data!.buffer,
        msgCall!.data!.byteOffset,
        msgCall!.data!.byteLength,
      );
      expect(view.getUint16(0, false)).toBe(SONY_MSG_Rest);
    });

    it('includes REST header with Out type and correct payload size', async () => {
      const requestData = new TextEncoder().encode('hello world');
      const responsePayload = new TextEncoder().encode('ok');
      const restResponse = buildRestResponse(responsePayload);
      const infoResponse = buildInfoResponse(restResponse.length);

      const driver = createMockMtpDriver([
        { responseCode: PTP_RC_OK, data: infoResponse },
        { responseCode: PTP_RC_OK, data: restResponse },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendRequest(requestData);

      // Parse the REST message body (after 2-byte type prefix)
      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      const msgData = msgCall!.data!.slice(2); // Skip type prefix

      // Parse REST header
      const restHeader = RestMsgHeaderStruct.unpack(msgData);
      expect(restHeader).not.toBeNull();
      expect(restHeader!['type']).toBe(2); // Rest_Out
      expect(restHeader!['size']).toBe(requestData.length);
    });
  });

  describe('sendSslData() sequence', () => {
    it('sends SSL data with correct TCP framing', async () => {
      const connectionId = 42;
      const sslPayload = new Uint8Array([0x16, 0x03, 0x01, 0x00, 0x05]); // TLS-like header

      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendSslData(connectionId, sslPayload);

      // Verify correct operation codes
      const writeCalls = driver.calls.filter(c => c.method === 'sendWriteCommand');
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[0].code).toBe(PTP_OC_SendProxyMessageInfo); // 0x948c
      expect(writeCalls[1].code).toBe(PTP_OC_SendProxyMessage);     // 0x948d
    });

    it('uses TCP message type prefix (0x0001)', async () => {
      const connectionId = 7;
      const sslPayload = new Uint8Array([1, 2, 3, 4]);

      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendSslData(connectionId, sslPayload);

      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      expect(msgCall).toBeDefined();

      const view = new DataView(
        msgCall!.data!.buffer,
        msgCall!.data!.byteOffset,
        msgCall!.data!.byteLength,
      );
      expect(view.getUint16(0, false)).toBe(SONY_MSG_Tcp);
    });

    it('embeds connectionId and data size in TCP payload', async () => {
      const connectionId = 99;
      const sslPayload = new Uint8Array([10, 20, 30, 40, 50]);

      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendSslData(connectionId, sslPayload);

      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      const rawMsg = msgCall!.data!;

      // After 2-byte type prefix, we have CommonMsgHeader (16 bytes), then TCP data
      // CommonMsgHeader: version(2) + type(4) + size(4) + padding(6) = 16 bytes
      // TCP header: socketFd(4) = 4 bytes
      // SSL data header: size(4) = 4 bytes
      // Then the actual SSL data

      // Skip: type prefix (2) + CommonMsgHeader (16) = 18
      const tcpStart = 2 + CommonMsgHeaderStruct.size;
      const tcpView = new DataView(
        rawMsg.buffer,
        rawMsg.byteOffset + tcpStart,
        rawMsg.byteLength - tcpStart,
      );

      // socketFd (big-endian int32) = connectionId
      expect(tcpView.getInt32(0, false)).toBe(connectionId);

      // SSL data size (big-endian int32) at offset 4
      expect(tcpView.getInt32(4, false)).toBe(sslPayload.length);

      // Actual SSL data at offset 8
      const actualData = new Uint8Array(rawMsg.buffer, rawMsg.byteOffset + tcpStart + 8, sslPayload.length);
      expect(actualData).toEqual(sslPayload);
    });
  });

  describe('sendEnd() sequence', () => {
    it('sends bye message via SendProxyMessageInfo/SendProxyMessage', async () => {
      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendEnd();

      // Verify correct operation codes
      const writeCalls = driver.calls.filter(c => c.method === 'sendWriteCommand');
      expect(writeCalls).toHaveLength(2);
      expect(writeCalls[0].code).toBe(PTP_OC_SendProxyMessageInfo); // 0x948c
      expect(writeCalls[1].code).toBe(PTP_OC_SendProxyMessage);     // 0x948d
    });

    it('sends message with Common type prefix (0x0000)', async () => {
      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendEnd();

      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      expect(msgCall).toBeDefined();

      const view = new DataView(
        msgCall!.data!.buffer,
        msgCall!.data!.byteOffset,
        msgCall!.data!.byteLength,
      );
      expect(view.getUint16(0, false)).toBe(SONY_MSG_Common);
    });

    it('bye message contains CommonMsgHeader with Bye subtype (0x402)', async () => {
      const driver = createMockMtpDriver([]);

      const protocol = new SonyAppInstallProtocol(driver);
      await protocol.sendEnd();

      const msgCall = driver.calls.find(
        c => c.method === 'sendWriteCommand' && c.code === PTP_OC_SendProxyMessage,
      );
      const rawMsg = msgCall!.data!;

      // Skip 2-byte type prefix, parse CommonMsgHeader
      const headerData = rawMsg.slice(2);
      const header = CommonMsgHeaderStruct.unpack(headerData);
      expect(header).not.toBeNull();
      expect(header!['version']).toBe(1);
      expect(header!['type']).toBe(0x402); // Common_Bye
    });
  });

  describe('full install flow sequence', () => {
    it('executes init → request → sslData → end in correct order', async () => {
      // Build camera responses for the full sequence
      const helloMsg = buildHelloResponse([
        { name: 'TCPT', id: 0x01 },
        { name: 'REST', id: 0x100 },
      ]);
      const helloInfo = buildInfoResponse(helloMsg.length);

      const restResponsePayload = new TextEncoder().encode('{"result":0}');
      const restResponseMsg = buildRestResponse(restResponsePayload);
      const restInfo = buildInfoResponse(restResponseMsg.length);

      const driver = createMockMtpDriver([
        // For sendInit: read info + read hello
        { responseCode: PTP_RC_OK, data: helloInfo },
        { responseCode: PTP_RC_OK, data: helloMsg },
        // For sendRequest: read info + read rest response
        { responseCode: PTP_RC_OK, data: restInfo },
        { responseCode: PTP_RC_OK, data: restResponseMsg },
      ]);

      const protocol = new SonyAppInstallProtocol(driver);

      // Execute the full sequence
      const protocols = await protocol.sendInit();
      expect(protocols).toHaveLength(2);

      const response = await protocol.sendRequest(
        new TextEncoder().encode('{"method":"start"}'),
      );
      expect(new TextDecoder().decode(response)).toBe('{"result":0}');

      await protocol.sendSslData(1, new Uint8Array([0xaa, 0xbb, 0xcc]));
      await protocol.sendEnd();

      // Verify the complete sequence of MTP operations
      const allCalls = driver.calls;

      // sendInit: write info + write msg + read info + read msg = 4 calls
      // sendRequest: write info + write msg + read info + read msg = 4 calls
      // sendSslData: write info + write msg = 2 calls
      // sendEnd: write info + write msg = 2 calls
      // Total: 12 calls
      expect(allCalls).toHaveLength(12);

      // Verify operation code pattern
      const codes = allCalls.map(c => c.code);
      expect(codes).toEqual([
        // sendInit
        PTP_OC_SendProxyMessageInfo,  // 0x948c
        PTP_OC_SendProxyMessage,      // 0x948d
        PTP_OC_GetProxyMessageInfo,   // 0x9488
        PTP_OC_GetProxyMessage,       // 0x9489
        // sendRequest
        PTP_OC_SendProxyMessageInfo,  // 0x948c
        PTP_OC_SendProxyMessage,      // 0x948d
        PTP_OC_GetProxyMessageInfo,   // 0x9488
        PTP_OC_GetProxyMessage,       // 0x9489
        // sendSslData
        PTP_OC_SendProxyMessageInfo,  // 0x948c
        PTP_OC_SendProxyMessage,      // 0x948d
        // sendEnd
        PTP_OC_SendProxyMessageInfo,  // 0x948c
        PTP_OC_SendProxyMessage,      // 0x948d
      ]);
    });
  });

  describe('operation code verification', () => {
    it('uses 0x9488 for GetProxyMessageInfo', async () => {
      expect(PTP_OC_GetProxyMessageInfo).toBe(0x9488);
    });

    it('uses 0x9489 for GetProxyMessage', async () => {
      expect(PTP_OC_GetProxyMessage).toBe(0x9489);
    });

    it('uses 0x948c for SendProxyMessageInfo', async () => {
      expect(PTP_OC_SendProxyMessageInfo).toBe(0x948c);
    });

    it('uses 0x948d for SendProxyMessage', async () => {
      expect(PTP_OC_SendProxyMessage).toBe(0x948d);
    });
  });
});
