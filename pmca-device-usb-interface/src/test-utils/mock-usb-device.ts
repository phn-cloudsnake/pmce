/**
 * Mock USBDevice for integration testing.
 *
 * Simulates WebUSB bulk endpoint behavior with:
 * - FIFO response queue for transferIn
 * - Sent data tracking for transferOut assertions
 * - Disconnect simulation
 * - Configurable DeviceBusy PTP responses for retry testing
 */

import { SONY_VENDOR_ID, PTP_HEADER_SIZE, PTP_TYPE_RESPONSE, PTP_RC_DeviceBusy } from '../constants.js';
import { StructUtil } from '../utils/struct-util.js';

/** PTP header struct for building mock response packets. */
const PtpHeaderStruct = new StructUtil([
  { name: 'size', type: 'int32' },
  { name: 'type', type: 'int16' },
  { name: 'code', type: 'int16' },
  { name: 'transaction', type: 'int32' },
]);

/**
 * Options for constructing a MockUSBDevice.
 */
export interface MockUSBDeviceOptions {
  /** USB vendor ID. Default: SONY_VENDOR_ID (0x054c). */
  vendorId?: number;
  /** USB product ID. Default: 0x0001. */
  productId?: number;
  /** Whether the device has a valid interface. Default: true. */
  hasInterface?: boolean;
  /** Whether the device has bulk endpoints. Default: true. */
  hasBulkEndpoints?: boolean;
}

/**
 * Mock USB device that simulates WebUSB bulk endpoint communication.
 *
 * Used by integration tests to simulate full camera communication flows
 * without real hardware. Supports:
 * - Response queue (FIFO): queue responses that transferIn will return
 * - Sent data tracking: all transferOut data is recorded for assertions
 * - Disconnect simulation: subsequent operations throw DOMException
 * - DeviceBusy response generation: for testing retry logic
 */
export class MockUSBDevice {
  // USBDevice identity fields
  readonly vendorId: number;
  readonly productId: number;
  readonly deviceClass = 0;
  readonly deviceSubclass = 0;
  readonly deviceProtocol = 0;
  readonly deviceVersionMajor = 1;
  readonly deviceVersionMinor = 0;
  readonly deviceVersionSubminor = 0;
  readonly usbVersionMajor = 2;
  readonly usbVersionMinor = 0;
  readonly usbVersionSubminor = 0;
  readonly manufacturerName = 'Sony';
  readonly productName = 'Mock Camera';
  readonly serialNumber = 'MOCK-001';
  readonly configurations: USBConfiguration[];
  readonly configuration: USBConfiguration | null;

  opened = false;
  ondisconnect: ((ev: Event) => void) | null = null;

  // Internal state
  private responseQueue: Uint8Array[] = [];
  private sentData: Uint8Array[] = [];
  private disconnected = false;
  private interfaceClaimed = false;
  private busyCountBeforeOk = 0;
  private busyCountRemaining = 0;

  // Endpoint config
  private readonly bulkInEndpoint: number;
  private readonly bulkOutEndpoint: number;
  private readonly hasInterface: boolean;
  private readonly hasBulkEndpoints: boolean;

  constructor(options?: MockUSBDeviceOptions) {
    this.vendorId = options?.vendorId ?? SONY_VENDOR_ID;
    this.productId = options?.productId ?? 0x0001;
    this.hasInterface = options?.hasInterface ?? true;
    this.hasBulkEndpoints = options?.hasBulkEndpoints ?? true;
    this.bulkInEndpoint = 1;
    this.bulkOutEndpoint = 2;

    // Build configuration structure
    const epIn: USBEndpoint = {
      endpointNumber: this.bulkInEndpoint,
      direction: 'in',
      type: 'bulk',
      packetSize: 512,
    };

    const epOut: USBEndpoint = {
      endpointNumber: this.bulkOutEndpoint,
      direction: 'out',
      type: 'bulk',
      packetSize: 512,
    };

    const alternate: USBAlternateInterface = {
      alternateSetting: 0,
      interfaceClass: 0xff,
      interfaceSubclass: 0,
      interfaceProtocol: 0,
      interfaceName: null,
      endpoints: this.hasBulkEndpoints ? [epIn, epOut] : [],
    };

    const iface: USBInterface = {
      interfaceNumber: 0,
      alternate,
      alternates: [alternate],
      claimed: false,
    };

    const config: USBConfiguration = {
      configurationValue: 1,
      configurationName: null,
      interfaces: this.hasInterface ? [iface] : [],
    };

    this.configurations = [config];
    this.configuration = config;
  }

  // ===========================================================================
  // Test utility methods
  // ===========================================================================

  /**
   * Queue a raw response that transferIn will return (FIFO order).
   * This is the raw data the device "sends" to the host.
   */
  queueResponse(data: Uint8Array): void {
    this.responseQueue.push(data);
  }

  /**
   * Queue multiple responses at once.
   */
  queueResponses(responses: Uint8Array[]): void {
    for (const r of responses) {
      this.responseQueue.push(r);
    }
  }

  /**
   * Queue a PTP response packet with the given response code and transaction ID.
   * Convenience method for building properly-framed PTP responses.
   */
  queuePtpResponse(responseCode: number, transaction: number): void {
    const header = PtpHeaderStruct.pack({
      size: PTP_HEADER_SIZE,
      type: PTP_TYPE_RESPONSE,
      code: responseCode,
      transaction,
    });
    this.responseQueue.push(header);
  }

  /**
   * Queue a DeviceBusy (0x2019) PTP response.
   * Used to test retry logic in the ExtCmd protocol.
   */
  queueDeviceBusyResponse(transaction: number): void {
    this.queuePtpResponse(PTP_RC_DeviceBusy, transaction);
  }

  /**
   * Configure the device to return N DeviceBusy responses before
   * subsequent queued responses. Useful for testing retry logic
   * without manually queueing each busy response.
   *
   * @param count Number of DeviceBusy responses to prepend to each transferIn.
   */
  setDeviceBusyCount(count: number): void {
    this.busyCountBeforeOk = count;
    this.busyCountRemaining = count;
  }

  /**
   * Get all data that has been sent to the device via transferOut.
   * Returns a copy of the internal array.
   */
  getSentData(): Uint8Array[] {
    return [...this.sentData];
  }

  /**
   * Get the last data sent via transferOut, or undefined if nothing was sent.
   */
  getLastSentData(): Uint8Array | undefined {
    return this.sentData[this.sentData.length - 1];
  }

  /**
   * Clear all sent data records.
   */
  clearSentData(): void {
    this.sentData = [];
  }

  /**
   * Clear the response queue.
   */
  clearResponseQueue(): void {
    this.responseQueue = [];
  }

  /**
   * Simulate a device disconnect. All subsequent USB operations will throw
   * a DOMException with name 'NotFoundError'.
   */
  simulateDisconnect(): void {
    this.disconnected = true;
  }

  /**
   * Reset the device state (undo disconnect, clear queues).
   * Named resetState to avoid conflict with USBDevice.reset().
   */
  resetState(): void {
    this.disconnected = false;
    this.responseQueue = [];
    this.sentData = [];
    this.interfaceClaimed = false;
    this.opened = false;
    this.busyCountBeforeOk = 0;
    this.busyCountRemaining = 0;
  }

  /**
   * Check if the interface is currently claimed.
   */
  isInterfaceClaimed(): boolean {
    return this.interfaceClaimed;
  }

  /**
   * Get the number of remaining responses in the queue.
   */
  getResponseQueueLength(): number {
    return this.responseQueue.length;
  }

  // ===========================================================================
  // USBDevice interface methods
  // ===========================================================================

  async open(): Promise<void> {
    this.assertNotDisconnected();
    this.opened = true;
  }

  async close(): Promise<void> {
    this.assertNotDisconnected();
    this.opened = false;
  }

  async forget(): Promise<void> {
    // No-op for mock
  }

  async selectConfiguration(configurationValue: number): Promise<void> {
    this.assertNotDisconnected();
    if (configurationValue !== 1) {
      throw new DOMException(
        `Configuration ${configurationValue} not found`,
        'NotFoundError',
      );
    }
  }

  async claimInterface(interfaceNumber: number): Promise<void> {
    this.assertNotDisconnected();
    if (!this.hasInterface) {
      throw new DOMException('Interface not found', 'NotFoundError');
    }
    this.interfaceClaimed = true;
  }

  async releaseInterface(interfaceNumber: number): Promise<void> {
    this.assertNotDisconnected();
    this.interfaceClaimed = false;
  }

  async selectAlternateInterface(
    interfaceNumber: number,
    alternateSetting: number,
  ): Promise<void> {
    this.assertNotDisconnected();
  }

  async controlTransferIn(
    setup: USBControlTransferParameters,
    length: number,
  ): Promise<USBInTransferResult> {
    this.assertNotDisconnected();
    return { status: 'ok', data: new DataView(new ArrayBuffer(0)) };
  }

  async controlTransferOut(
    setup: USBControlTransferParameters,
    data?: BufferSource,
  ): Promise<USBOutTransferResult> {
    this.assertNotDisconnected();
    return { status: 'ok', bytesWritten: data ? getByteLength(data) : 0 };
  }

  /**
   * Simulate a bulk IN transfer. Dequeues the next response from the queue.
   * If busy count is active, generates a DeviceBusy PTP response first.
   */
  async transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<USBInTransferResult> {
    this.assertNotDisconnected();

    // If busy-count mode is active and we still have busy responses to send
    if (this.busyCountRemaining > 0) {
      this.busyCountRemaining--;
      // Build a DeviceBusy response packet
      const busyPacket = PtpHeaderStruct.pack({
        size: PTP_HEADER_SIZE,
        type: PTP_TYPE_RESPONSE,
        code: PTP_RC_DeviceBusy,
        transaction: 0, // Transaction doesn't matter for busy
      });
      return {
        status: 'ok',
        data: new DataView(busyPacket.buffer, busyPacket.byteOffset, busyPacket.byteLength),
      };
    }

    // Reset busy counter for next operation
    if (this.busyCountBeforeOk > 0) {
      this.busyCountRemaining = this.busyCountBeforeOk;
    }

    // Dequeue next response
    const response = this.responseQueue.shift();
    if (!response) {
      // Return empty data if queue is exhausted (triggers empty-read retry in MtpDriver)
      return {
        status: 'ok',
        data: new DataView(new ArrayBuffer(0)),
      };
    }

    // Truncate to requested length if response is longer
    const truncated = response.length > length ? response.slice(0, length) : response;
    return {
      status: 'ok',
      data: new DataView(
        truncated.buffer,
        truncated.byteOffset,
        truncated.byteLength,
      ),
    };
  }

  /**
   * Simulate a bulk OUT transfer. Records the sent data for later assertion.
   */
  async transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<USBOutTransferResult> {
    this.assertNotDisconnected();

    // Record a copy of the sent data
    const bytes = bufferSourceToUint8Array(data);
    this.sentData.push(bytes);

    return { status: 'ok', bytesWritten: bytes.length };
  }

  async clearHalt(direction: USBDirection, endpointNumber: number): Promise<void> {
    this.assertNotDisconnected();
  }

  async resetDevice(): Promise<void> {
    this.assertNotDisconnected();
  }

  async isochronousTransferIn(
    endpointNumber: number,
    packetLengths: number[],
  ): Promise<USBIsochronousInTransferResult> {
    throw new DOMException('Not implemented', 'NotSupportedError');
  }

  async isochronousTransferOut(
    endpointNumber: number,
    data: BufferSource,
    packetLengths: number[],
  ): Promise<USBIsochronousOutTransferResult> {
    throw new DOMException('Not implemented', 'NotSupportedError');
  }

  // EventTarget stubs
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    // No-op
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    // No-op
  }

  dispatchEvent(event: Event): boolean {
    return true;
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /**
   * Throw a DOMException if the device has been disconnected.
   */
  private assertNotDisconnected(): void {
    if (this.disconnected) {
      throw new DOMException(
        'Device has been disconnected',
        'NotFoundError',
      );
    }
  }
}

/**
 * Convert a BufferSource (ArrayBuffer or ArrayBufferView) to Uint8Array.
 */
function bufferSourceToUint8Array(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  // ArrayBufferView (TypedArray or DataView)
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

/**
 * Get byte length from a BufferSource.
 */
function getByteLength(source: BufferSource): number {
  if (source instanceof ArrayBuffer) {
    return source.byteLength;
  }
  return source.byteLength;
}

/**
 * Cast a MockUSBDevice to USBDevice for use with WebUsbBackend.
 * This is safe because MockUSBDevice implements the full USBDevice interface.
 */
export function asMockDevice(mock: MockUSBDevice): USBDevice {
  return mock as unknown as USBDevice;
}
