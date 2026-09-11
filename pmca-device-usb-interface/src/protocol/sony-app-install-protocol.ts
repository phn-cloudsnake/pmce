/**
 * Sony App Install protocol layer.
 *
 * Implements the camera-side app installation communication protocol
 * using MTP proxy message operation codes. Handles sending and receiving
 * structured messages (init, SSL proxy, REST request/response, end).
 *
 * Port of Python's SonyMtpAppInstallDevice + SonyAppInstallCamera.
 */

import {
  PTP_OC_GetProxyMessageInfo,
  PTP_OC_GetProxyMessage,
  PTP_OC_SendProxyMessageInfo,
  PTP_OC_SendProxyMessage,
} from '../constants.js';
import { MtpProtocolError } from '../errors.js';
import { StructUtil } from '../utils/struct-util.js';
import type { MtpDriver } from './mtp-driver.js';

// =============================================================================
// App Install Protocol Response Codes
// =============================================================================

/** Camera response: no data available yet. */
const PTP_RC_NoData = 0xa488;

/** Camera response: device busy, retry. */
const PTP_RC_SonyDeviceBusy = 0xa489;

// =============================================================================
// Message Type Constants
// =============================================================================

/** Top-level message type: Common (init, bye). */
const SONY_MSG_Common = 0;

/** Top-level message type: TCP (SSL proxy). */
const SONY_MSG_Tcp = 1;

/** Top-level message type: REST (request/response). */
const SONY_MSG_Rest = 2;

/** Common sub-type: Start (init request). */
const SONY_MSG_Common_Start = 0x400;

/** Common sub-type: Hello (init response with protocols). */
const SONY_MSG_Common_Hello = 0x401;

/** Common sub-type: Bye (session end). */
const SONY_MSG_Common_Bye = 0x402;

/** TCP sub-type: Proxy connect (SSL start). */
const SONY_MSG_Tcp_ProxyConnect = 0x501;

/** TCP sub-type: Proxy disconnect (SSL end from camera). */
const SONY_MSG_Tcp_ProxyDisconnect = 0x502;

/** TCP sub-type: Proxy data (SSL data). */
const SONY_MSG_Tcp_ProxyData = 0x503;

/** TCP sub-type: Proxy end (SSL end from host). */
const SONY_MSG_Tcp_ProxyEnd = 0x504;

/** REST sub-type: Incoming request from camera. */
const SONY_MSG_Rest_In = 0;

/** REST sub-type: Outgoing response/request to camera. */
const SONY_MSG_Rest_Out = 2;

// =============================================================================
// Struct Definitions (Big-Endian, matching Python)
// =============================================================================

/** Info message header for proxy message info commands (little-endian). */
const InfoMsgHeaderStruct = new StructUtil([
  { name: 'flags', type: 'int32' },
  { name: 'magic', type: 'int16' },
  { name: 'reserved1', type: 'int16' },
  { name: 'dataSize', type: 'int32' },
  { name: 'reserved2', type: 'int16' },
  { name: 'padding', type: 'str', length: 42 },
], 'little-endian');

const INFO_MSG_HEADER_MAGIC = 0xb481;

/** Common message header (big-endian). */
const CommonMsgHeaderStruct = new StructUtil([
  { name: 'version', type: 'int16' },
  { name: 'type', type: 'int32' },
  { name: 'size', type: 'int32' },
  { name: 'padding', type: 'str', length: 6 },
], 'big-endian');

const COMMON_MSG_VERSION = 1;

/** TCP message header (big-endian). */
const TcpMsgHeaderStruct = new StructUtil([
  { name: 'socketFd', type: 'int32' },
], 'big-endian');

/** REST message header (big-endian). */
const RestMsgHeaderStruct = new StructUtil([
  { name: 'type', type: 'int16' },
  { name: 'size', type: 'int16' },
], 'big-endian');

/** Proxy connect message header (big-endian). */
const ProxyConnectMsgHeaderStruct = new StructUtil([
  { name: 'port', type: 'int16' },
  { name: 'hostSize', type: 'int32' },
], 'big-endian');

/** SSL data message header (big-endian). */
const SslDataMsgHeaderStruct = new StructUtil([
  { name: 'size', type: 'int32' },
], 'big-endian');

/** Protocol message header (big-endian). */
const ProtocolMsgHeaderStruct = new StructUtil([
  { name: 'numProtocols', type: 'int32' },
], 'big-endian');

/** Single protocol entry (big-endian). */
const ProtocolMsgProtoStruct = new StructUtil([
  { name: 'name', type: 'str', length: 4 },
  { name: 'id', type: 'int16' },
], 'big-endian');

/** Three-value message for bye/end packets (big-endian). */
const ThreeValueMsgStruct = new StructUtil([
  { name: 'a', type: 'int16' },
  { name: 'b', type: 'int32' },
  { name: 'c', type: 'int32' },
], 'big-endian');

// =============================================================================
// Default protocols to announce during init
// =============================================================================

const DEFAULT_PROTOCOLS: Array<{ name: string; id: number }> = [
  { name: 'TCPT', id: 0x01 },
  { name: 'REST', id: 0x100 },
];

// =============================================================================
// Message Types
// =============================================================================

/** Parsed app install message from the camera. */
export type AppInstallMessage =
  | { type: 'init'; protocols: Array<{ name: string; id: number }> }
  | { type: 'sslStart'; connectionId: number; host: string; port: number }
  | { type: 'sslData'; connectionId: number; data: Uint8Array }
  | { type: 'sslEnd'; connectionId: number }
  | { type: 'request'; data: Uint8Array }
  | { type: 'response'; data: Uint8Array };

// =============================================================================
// SonyAppInstallProtocol
// =============================================================================

/**
 * Sony App Install protocol for communicating with a camera in app
 * installation mode via MTP proxy messages.
 *
 * Combines the transport layer (MTP proxy message read/write with info headers)
 * and the message framing layer (Common/TCP/REST message types).
 */
export class SonyAppInstallProtocol {
  private driver: MtpDriver;

  constructor(driver: MtpDriver) {
    this.driver = driver;
  }

  // ===========================================================================
  // Low-level transport: raw message send/receive via MTP
  // ===========================================================================

  /**
   * Send a raw typed message to the camera.
   *
   * @param type - The top-level message type (0=Common, 1=Tcp, 2=Rest).
   * @param data - The message payload (includes sub-headers).
   */
  async sendMessage(type: number, data: Uint8Array): Promise<void> {
    // Pack the message: 2-byte big-endian type prefix + data
    const message = new Uint8Array(2 + data.length);
    const msgView = new DataView(message.buffer);
    msgView.setUint16(0, type, false); // big-endian
    message.set(data, 2);

    // Send info header (metadata with data size)
    const infoHeader = InfoMsgHeaderStruct.pack({
      flags: 0,
      magic: INFO_MSG_HEADER_MAGIC,
      reserved1: 0,
      dataSize: message.length,
      reserved2: 0,
      padding: new Uint8Array(42),
    });

    let responseCode = PTP_RC_SonyDeviceBusy;
    while (responseCode === PTP_RC_SonyDeviceBusy) {
      responseCode = await this.driver.sendWriteCommand(
        PTP_OC_SendProxyMessageInfo,
        [],
        infoHeader,
      );
    }
    this.checkResponse(responseCode);

    // Send actual message data
    responseCode = PTP_RC_SonyDeviceBusy;
    while (responseCode === PTP_RC_SonyDeviceBusy) {
      responseCode = await this.driver.sendWriteCommand(
        PTP_OC_SendProxyMessage,
        [],
        message,
      );
    }
    this.checkResponse(responseCode);
  }

  /**
   * Receive and parse the next message from the camera.
   *
   * @returns A parsed AppInstallMessage, or null if no data is available.
   */
  async receiveMessage(): Promise<AppInstallMessage | null> {
    // Read info header to get message size
    const { responseCode: infoRc, data: infoData } = await this.driver.sendReadCommand(
      PTP_OC_GetProxyMessageInfo,
      [0],
    );
    this.checkResponse(infoRc);

    const info = InfoMsgHeaderStruct.unpack(infoData);
    if (!info || (info['magic'] as number) !== INFO_MSG_HEADER_MAGIC) {
      throw new MtpProtocolError('Invalid proxy message info header magic', 0);
    }

    const dataSize = info['dataSize'] as number;

    // Read actual message data
    const { responseCode: msgRc, data: msgData } = await this.driver.sendReadCommand(
      PTP_OC_GetProxyMessage,
      [0],
    );

    // PTP_RC_NoData means empty buffer
    if (msgRc === PTP_RC_NoData) {
      return null;
    }
    this.checkResponse(msgRc);

    const data = msgData.slice(0, dataSize);
    if (data.length === 0) {
      return null;
    }

    // Parse message type (first 2 bytes, big-endian)
    const view = new DataView(data.buffer, data.byteOffset, data.length);
    const msgType = view.getUint16(0, false); // big-endian
    const payload = data.slice(2);

    return this.parseMessage(msgType, payload);
  }

  // ===========================================================================
  // High-level protocol methods
  // ===========================================================================

  /**
   * Send initialization message and receive the protocol list response.
   *
   * @param protocols - List of protocols to announce (default: TCPT + REST).
   * @returns Array of protocols supported by the camera.
   */
  async sendInit(
    protocols: Array<{ name: string; id: number }> = DEFAULT_PROTOCOLS,
  ): Promise<Array<{ name: string; id: number }>> {
    // Build protocol list payload
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
    const commonPayload = this.buildCommonMessage(SONY_MSG_Common_Start, protoData);
    await this.sendMessage(SONY_MSG_Common, commonPayload);

    // Wait for init response
    const response = await this.waitForMessage('init');
    return response.protocols;
  }

  /**
   * Send a REST request to the camera and wait for the response.
   *
   * @param data - The REST request payload.
   * @returns The REST response payload from the camera.
   */
  async sendRequest(data: Uint8Array): Promise<Uint8Array> {
    // Build REST message with Rest_Out subtype
    const restHeader = RestMsgHeaderStruct.pack({
      type: SONY_MSG_Rest_Out,
      size: data.length,
    });
    const restPayload = new Uint8Array(restHeader.length + data.length);
    restPayload.set(restHeader, 0);
    restPayload.set(data, restHeader.length);

    await this.sendMessage(SONY_MSG_Rest, restPayload);

    // Wait for response message
    const response = await this.waitForMessage('response');
    return response.data;
  }

  /**
   * Send SSL data to the camera for a specific connection.
   *
   * @param connectionId - The socket file descriptor / connection ID.
   * @param data - The SSL data to forward.
   */
  async sendSslData(connectionId: number, data: Uint8Array): Promise<void> {
    const sslDataHeader = SslDataMsgHeaderStruct.pack({ size: data.length });
    const tcpPayload = new Uint8Array(TcpMsgHeaderStruct.size + sslDataHeader.length + data.length);
    tcpPayload.set(TcpMsgHeaderStruct.pack({ socketFd: connectionId }), 0);
    tcpPayload.set(sslDataHeader, TcpMsgHeaderStruct.size);
    tcpPayload.set(data, TcpMsgHeaderStruct.size + sslDataHeader.length);

    const commonPayload = this.buildCommonMessage(SONY_MSG_Tcp_ProxyData, tcpPayload);
    await this.sendMessage(SONY_MSG_Tcp, commonPayload);
  }

  /**
   * Notify the camera that an SSL connection has been closed.
   *
   * @param connectionId - The socket file descriptor / connection ID.
   */
  async sendSslEnd(connectionId: number): Promise<void> {
    const threeValue = ThreeValueMsgStruct.pack({ a: 1, b: 1, c: 0 });
    const tcpPayload = new Uint8Array(TcpMsgHeaderStruct.size + threeValue.length);
    tcpPayload.set(TcpMsgHeaderStruct.pack({ socketFd: connectionId }), 0);
    tcpPayload.set(threeValue, TcpMsgHeaderStruct.size);

    const commonPayload = this.buildCommonMessage(SONY_MSG_Tcp_ProxyEnd, tcpPayload);
    await this.sendMessage(SONY_MSG_Tcp, commonPayload);
  }

  /**
   * Send a bye/end message to terminate the protocol session.
   */
  async sendEnd(): Promise<void> {
    const threeValue = ThreeValueMsgStruct.pack({ a: 0, b: 0, c: 0 });
    const commonPayload = this.buildCommonMessage(SONY_MSG_Common_Bye, threeValue);
    await this.sendMessage(SONY_MSG_Common, commonPayload);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Build a CommonMsgHeader-wrapped payload.
   */
  private buildCommonMessage(subType: number, innerData: Uint8Array): Uint8Array {
    const totalSize = CommonMsgHeaderStruct.size + innerData.length;
    const header = CommonMsgHeaderStruct.pack({
      version: COMMON_MSG_VERSION,
      type: subType,
      size: totalSize,
      padding: new Uint8Array(6),
    });
    const result = new Uint8Array(totalSize);
    result.set(header, 0);
    result.set(innerData, CommonMsgHeaderStruct.size);
    return result;
  }

  /**
   * Parse a raw message into a typed AppInstallMessage based on top-level type.
   */
  private parseMessage(msgType: number, data: Uint8Array): AppInstallMessage | null {
    if (msgType === SONY_MSG_Common) {
      return this.parseCommonMessage(data);
    } else if (msgType === SONY_MSG_Tcp) {
      return this.parseTcpMessage(data);
    } else if (msgType === SONY_MSG_Rest) {
      return this.parseRestMessage(data);
    }
    throw new MtpProtocolError(`Unknown app install message type: 0x${msgType.toString(16)}`, 0);
  }

  /**
   * Parse a Common-type message (init response, bye).
   */
  private parseCommonMessage(data: Uint8Array): AppInstallMessage | null {
    const header = CommonMsgHeaderStruct.unpack(data);
    if (!header) {
      throw new MtpProtocolError('Common message too short for header', 0);
    }

    const subType = header['type'] as number;
    const size = header['size'] as number;
    const payload = data.slice(CommonMsgHeaderStruct.size, size);

    if (subType === SONY_MSG_Common_Hello) {
      // Parse protocol list
      const protoHeader = ProtocolMsgHeaderStruct.unpack(payload);
      if (!protoHeader) {
        throw new MtpProtocolError('Protocol message header too short', 0);
      }
      const numProtocols = protoHeader['numProtocols'] as number;
      const protocols: Array<{ name: string; id: number }> = [];

      for (let i = 0; i < numProtocols; i++) {
        const proto = ProtocolMsgProtoStruct.unpack(
          payload,
          ProtocolMsgHeaderStruct.size + i * ProtocolMsgProtoStruct.size,
        );
        if (proto) {
          const nameBytes = proto['name'] as Uint8Array;
          const name = new TextDecoder('latin1').decode(nameBytes);
          protocols.push({ name, id: proto['id'] as number });
        }
      }
      return { type: 'init', protocols };
    } else if (subType === SONY_MSG_Common_Bye) {
      throw new MtpProtocolError('Bye received from camera', 0);
    }

    throw new MtpProtocolError(`Unknown common message subtype: 0x${subType.toString(16)}`, 0);
  }

  /**
   * Parse a TCP-type message (SSL start, data, end).
   */
  private parseTcpMessage(data: Uint8Array): AppInstallMessage {
    const header = CommonMsgHeaderStruct.unpack(data);
    if (!header) {
      throw new MtpProtocolError('TCP message too short for common header', 0);
    }

    const subType = header['type'] as number;
    const size = header['size'] as number;
    const innerData = data.slice(CommonMsgHeaderStruct.size, size);

    const tcpHeader = TcpMsgHeaderStruct.unpack(innerData);
    if (!tcpHeader) {
      throw new MtpProtocolError('TCP message too short for TCP header', 0);
    }
    const connectionId = tcpHeader['socketFd'] as number;
    const tcpPayload = innerData.slice(TcpMsgHeaderStruct.size);

    if (subType === SONY_MSG_Tcp_ProxyConnect) {
      const proxyHeader = ProxyConnectMsgHeaderStruct.unpack(tcpPayload);
      if (!proxyHeader) {
        throw new MtpProtocolError('Proxy connect message too short', 0);
      }
      const port = proxyHeader['port'] as number;
      const hostSize = proxyHeader['hostSize'] as number;
      const hostBytes = tcpPayload.slice(ProxyConnectMsgHeaderStruct.size, ProxyConnectMsgHeaderStruct.size + hostSize);
      const host = new TextDecoder('latin1').decode(hostBytes);
      return { type: 'sslStart', connectionId, host, port };
    } else if (subType === SONY_MSG_Tcp_ProxyDisconnect) {
      return { type: 'sslEnd', connectionId };
    } else if (subType === SONY_MSG_Tcp_ProxyData) {
      const sslDataHeader = SslDataMsgHeaderStruct.unpack(tcpPayload);
      if (!sslDataHeader) {
        throw new MtpProtocolError('SSL data message too short', 0);
      }
      const sslDataSize = sslDataHeader['size'] as number;
      const sslData = tcpPayload.slice(SslDataMsgHeaderStruct.size, SslDataMsgHeaderStruct.size + sslDataSize);
      return { type: 'sslData', connectionId, data: sslData };
    }

    throw new MtpProtocolError(`Unknown TCP message subtype: 0x${subType.toString(16)}`, 0);
  }

  /**
   * Parse a REST-type message (request or response).
   */
  private parseRestMessage(data: Uint8Array): AppInstallMessage {
    const header = RestMsgHeaderStruct.unpack(data);
    if (!header) {
      throw new MtpProtocolError('REST message too short for header', 0);
    }

    const restType = header['type'] as number;
    const size = header['size'] as number;
    const payload = data.slice(RestMsgHeaderStruct.size, RestMsgHeaderStruct.size + size);

    if (restType === SONY_MSG_Rest_In) {
      return { type: 'request', data: payload };
    } else {
      // Rest_Out = response from camera
      return { type: 'response', data: payload };
    }
  }

  /**
   * Wait for a specific message type, discarding null (empty) responses.
   */
  private async waitForMessage<T extends AppInstallMessage['type']>(
    expectedType: T,
  ): Promise<Extract<AppInstallMessage, { type: T }>> {
    let msg: AppInstallMessage | null = null;
    while (msg === null) {
      msg = await this.receiveMessage();
    }
    if (msg.type !== expectedType) {
      throw new MtpProtocolError(
        `Expected '${expectedType}' message, got '${msg.type}'`,
        0,
      );
    }
    return msg as Extract<AppInstallMessage, { type: T }>;
  }

  /**
   * Check an MTP response code and throw if it indicates an error.
   * Allows PTP_RC_OK (0x2001).
   */
  private checkResponse(responseCode: number): void {
    const PTP_RC_OK = 0x2001;
    if (responseCode !== PTP_RC_OK) {
      throw new MtpProtocolError(
        `App install protocol error: response 0x${responseCode.toString(16)}`,
        responseCode,
      );
    }
  }
}
