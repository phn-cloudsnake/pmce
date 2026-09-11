/**
 * WebUSB backend for raw USB communication with Sony cameras.
 *
 * Wraps the WebUSB API to provide bulk transfer read/write
 * and vendor-specific control transfers.
 */

import {
  SONY_VENDOR_ID,
  USB_DEFAULT_TIMEOUT,
} from '../constants.js';
import { UsbTransportError } from '../errors.js';

/** Configuration options for the WebUSB backend. */
export interface WebUsbBackendOptions {
  /** Transfer timeout in milliseconds. Default: 5000ms */
  timeout?: number;
}

/**
 * Low-level WebUSB backend that handles device access,
 * bulk transfers, and vendor control requests.
 */
export class WebUsbBackend {
  private device: USBDevice;
  private interfaceNumber = 0;
  private epIn!: USBEndpoint;
  private epOut!: USBEndpoint;
  private timeout: number;

  /**
   * Request a Sony USB device from the user via the WebUSB chooser.
   * Filters for Sony vendor ID (0x054c).
   */
  static async requestDevice(
    options?: WebUsbBackendOptions,
  ): Promise<WebUsbBackend> {
    try {
      const device = await navigator.usb.requestDevice({
        filters: [{ vendorId: SONY_VENDOR_ID }],
      });
      return new WebUsbBackend(device, options);
    } catch (error) {
      throw wrapError('Failed to request USB device', error);
    }
  }

  constructor(device: USBDevice, options?: WebUsbBackendOptions) {
    this.device = device;
    this.timeout = options?.timeout ?? USB_DEFAULT_TIMEOUT;
  }

  /**
   * Open the device, select configuration 1, claim the first interface,
   * and identify bulk IN/OUT endpoints.
   */
  async open(): Promise<void> {
    try {
      await this.device.open();
      await this.device.selectConfiguration(1);

      const iface = this.device.configuration?.interfaces[0];
      if (!iface) {
        throw new UsbTransportError(
          'No interface found on USB device',
          undefined,
        );
      }

      this.interfaceNumber = iface.interfaceNumber;
      await this.device.claimInterface(this.interfaceNumber);

      const alternate = iface.alternate;
      const epIn = alternate.endpoints.find(
        (ep) => ep.direction === 'in' && ep.type === 'bulk',
      );
      const epOut = alternate.endpoints.find(
        (ep) => ep.direction === 'out' && ep.type === 'bulk',
      );

      if (!epIn || !epOut) {
        throw new UsbTransportError(
          'Could not identify bulk IN/OUT endpoints',
          undefined,
        );
      }

      this.epIn = epIn;
      this.epOut = epOut;
    } catch (error) {
      if (error instanceof UsbTransportError) {
        throw error;
      }
      throw wrapError('Failed to open USB device', error);
    }
  }

  /**
   * Read data from the device via bulk IN transfer.
   * @param length Maximum number of bytes to read.
   * @returns The data received from the device.
   */
  async read(length: number): Promise<Uint8Array> {
    try {
      const result = await this.device.transferIn(
        this.epIn.endpointNumber,
        length,
      );

      if (result.data) {
        return new Uint8Array(result.data.buffer);
      }
      return new Uint8Array(0);
    } catch (error) {
      await this.tryReleaseInterface();
      throw wrapError('USB read failed', error);
    }
  }

  /**
   * Write data to the device via bulk OUT transfer.
   * @param data The data to send to the device.
   */
  async write(data: Uint8Array): Promise<void> {
    try {
      await this.device.transferOut(this.epOut.endpointNumber, data as BufferSource);
    } catch (error) {
      await this.tryReleaseInterface();
      throw wrapError('USB write failed', error);
    }
  }

  /**
   * Send a vendor-specific control transfer (OUT direction).
   * @param request The bRequest field.
   * @param value The wValue field.
   * @param index The wIndex field.
   * @param data Optional data payload.
   */
  async vendorRequestOut(
    request: number,
    value: number,
    index: number,
    data?: Uint8Array,
  ): Promise<void> {
    try {
      await this.device.controlTransferOut(
        {
          requestType: 'vendor',
          recipient: 'device',
          request,
          value,
          index,
        },
        data as BufferSource | undefined,
      );
    } catch (error) {
      throw wrapError('USB vendor request failed', error);
    }
  }

  /**
   * Release the claimed interface and close the device.
   */
  async close(): Promise<void> {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
      await this.device.close();
    } catch (error) {
      throw wrapError('Failed to close USB device', error);
    }
  }

  /**
   * Get the vendor and product IDs of the connected device.
   */
  getDeviceIds(): { vendorId: number; productId: number } {
    return {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
    };
  }

  /**
   * Attempt to release the interface on unrecoverable errors.
   * Swallows any errors during cleanup.
   */
  private async tryReleaseInterface(): Promise<void> {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Wrap a caught error (typically a DOMException from WebUSB)
 * into a UsbTransportError.
 */
function wrapError(message: string, error: unknown): UsbTransportError {
  if (error instanceof DOMException) {
    return new UsbTransportError(
      `${message}: ${error.message}`,
      error.name,
      error,
    );
  }
  if (error instanceof Error) {
    return new UsbTransportError(message, undefined, error);
  }
  return new UsbTransportError(message);
}
