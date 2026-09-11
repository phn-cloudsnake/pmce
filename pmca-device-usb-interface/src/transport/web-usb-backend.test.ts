import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebUsbBackend } from './web-usb-backend.js';
import { UsbTransportError } from '../errors.js';
import { SONY_VENDOR_ID } from '../constants.js';

/**
 * Mock USBEndpoint simulating a bulk endpoint.
 */
function createMockEndpoint(
  direction: 'in' | 'out',
  endpointNumber: number,
): USBEndpoint {
  return {
    endpointNumber,
    direction,
    type: 'bulk',
    packetSize: 512,
  } as USBEndpoint;
}

/**
 * Mock USBDevice that simulates WebUSB bulk endpoints.
 */
function createMockUSBDevice(options?: {
  vendorId?: number;
  productId?: number;
  hasInterface?: boolean;
  hasBulkEndpoints?: boolean;
}): USBDevice {
  const vendorId = options?.vendorId ?? SONY_VENDOR_ID;
  const productId = options?.productId ?? 0x0001;
  const hasInterface = options?.hasInterface ?? true;
  const hasBulkEndpoints = options?.hasBulkEndpoints ?? true;

  const epIn = createMockEndpoint('in', 1);
  const epOut = createMockEndpoint('out', 2);

  const alternate: USBAlternateInterface = {
    alternateSetting: 0,
    interfaceClass: 0xff,
    interfaceSubclass: 0,
    interfaceProtocol: 0,
    interfaceName: undefined,
    endpoints: hasBulkEndpoints ? [epIn, epOut] : [],
  };

  const iface: USBInterface = {
    interfaceNumber: 0,
    alternate,
    alternates: [alternate],
    claimed: false,
  };

  const configuration: USBConfiguration = {
    configurationValue: 1,
    configurationName: undefined,
    interfaces: hasInterface ? [iface] : [],
  };

  return {
    vendorId,
    productId,
    configuration,
    configurations: [configuration],
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    deviceVersionMajor: 1,
    deviceVersionMinor: 0,
    deviceVersionSubminor: 0,
    manufacturerName: 'Sony',
    productName: 'Camera',
    serialNumber: '12345',
    usbVersionMajor: 2,
    usbVersionMinor: 0,
    usbVersionSubminor: 0,
    opened: false,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    forget: vi.fn().mockResolvedValue(undefined),
    selectConfiguration: vi.fn().mockResolvedValue(undefined),
    claimInterface: vi.fn().mockResolvedValue(undefined),
    releaseInterface: vi.fn().mockResolvedValue(undefined),
    selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
    controlTransferIn: vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) }),
    controlTransferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 0 }),
    transferIn: vi.fn().mockResolvedValue({
      status: 'ok',
      data: new DataView(new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer),
    }),
    transferOut: vi.fn().mockResolvedValue({ status: 'ok', bytesWritten: 4 }),
    clearHalt: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    isochronousTransferIn: vi.fn(),
    isochronousTransferOut: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    ondisconnect: null,
  } as unknown as USBDevice;
}

/**
 * Helper to set up navigator.usb mock.
 */
function mockNavigatorUsb(device: USBDevice | null) {
  const requestDevice = device
    ? vi.fn().mockResolvedValue(device)
    : vi.fn().mockRejectedValue(new DOMException('No device selected', 'NotFoundError'));

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      usb: {
        requestDevice,
        getDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    },
    writable: true,
    configurable: true,
  });

  return requestDevice;
}

describe('WebUsbBackend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('requestDevice()', () => {
    it('filters by Sony vendor ID (0x054c)', async () => {
      const device = createMockUSBDevice();
      const requestDevice = mockNavigatorUsb(device);

      await WebUsbBackend.requestDevice();

      expect(requestDevice).toHaveBeenCalledWith({
        filters: [{ vendorId: SONY_VENDOR_ID }],
      });
    });

    it('throws UsbTransportError when user denies device access', async () => {
      mockNavigatorUsb(null);

      await expect(WebUsbBackend.requestDevice()).rejects.toThrow(UsbTransportError);
    });

    it('wraps DOMException with exception name when no device found', async () => {
      mockNavigatorUsb(null);

      try {
        await WebUsbBackend.requestDevice();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UsbTransportError);
        expect((error as UsbTransportError).domExceptionName).toBe('NotFoundError');
      }
    });
  });

  describe('open()', () => {
    it('claims interface and identifies bulk endpoints', async () => {
      const device = createMockUSBDevice();
      mockNavigatorUsb(device);

      const backend = new WebUsbBackend(device);
      await backend.open();

      expect(device.open).toHaveBeenCalled();
      expect(device.selectConfiguration).toHaveBeenCalledWith(1);
      expect(device.claimInterface).toHaveBeenCalledWith(0);
    });

    it('throws UsbTransportError when no interface found', async () => {
      const device = createMockUSBDevice({ hasInterface: false });
      mockNavigatorUsb(device);

      const backend = new WebUsbBackend(device);

      await expect(backend.open()).rejects.toThrow(UsbTransportError);
    });

    it('throws UsbTransportError when no bulk endpoints found', async () => {
      const device = createMockUSBDevice({ hasBulkEndpoints: false });
      mockNavigatorUsb(device);

      const backend = new WebUsbBackend(device);

      await expect(backend.open()).rejects.toThrow(UsbTransportError);
    });
  });

  describe('read()', () => {
    it('returns data from transferIn as Uint8Array', async () => {
      const device = createMockUSBDevice();
      const backend = new WebUsbBackend(device);
      await backend.open();

      const data = await backend.read(64);

      expect(data).toBeInstanceOf(Uint8Array);
      expect(data).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
      expect(device.transferIn).toHaveBeenCalledWith(1, 64);
    });

    it('returns empty Uint8Array when transferIn has no data', async () => {
      const device = createMockUSBDevice();
      (device.transferIn as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        data: undefined,
      });

      const backend = new WebUsbBackend(device);
      await backend.open();

      const data = await backend.read(64);
      expect(data).toEqual(new Uint8Array(0));
    });
  });

  describe('write()', () => {
    it('calls transferOut with data', async () => {
      const device = createMockUSBDevice();
      const backend = new WebUsbBackend(device);
      await backend.open();

      const payload = new Uint8Array([0xAA, 0xBB, 0xCC]);
      await backend.write(payload);

      expect(device.transferOut).toHaveBeenCalledWith(2, payload);
    });
  });

  describe('close()', () => {
    it('releases interface and closes device', async () => {
      const device = createMockUSBDevice();
      const backend = new WebUsbBackend(device);
      await backend.open();

      await backend.close();

      expect(device.releaseInterface).toHaveBeenCalledWith(0);
      expect(device.close).toHaveBeenCalled();
    });
  });

  describe('error wrapping', () => {
    it('wraps DOMException in UsbTransportError with exception name on read', async () => {
      const device = createMockUSBDevice();
      const domError = new DOMException('Transfer failed', 'NetworkError');
      (device.transferIn as ReturnType<typeof vi.fn>).mockRejectedValue(domError);

      const backend = new WebUsbBackend(device);
      await backend.open();

      try {
        await backend.read(64);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UsbTransportError);
        const usbError = error as UsbTransportError;
        expect(usbError.domExceptionName).toBe('NetworkError');
        expect(usbError.message).toContain('Transfer failed');
      }
    });

    it('wraps DOMException in UsbTransportError with exception name on write', async () => {
      const device = createMockUSBDevice();
      const domError = new DOMException('Output failed', 'AbortError');
      (device.transferOut as ReturnType<typeof vi.fn>).mockRejectedValue(domError);

      const backend = new WebUsbBackend(device);
      await backend.open();

      try {
        await backend.write(new Uint8Array([1, 2, 3]));
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UsbTransportError);
        const usbError = error as UsbTransportError;
        expect(usbError.domExceptionName).toBe('AbortError');
        expect(usbError.message).toContain('Output failed');
      }
    });

    it('wraps non-DOMException errors without exception name', async () => {
      const device = createMockUSBDevice();
      (device.transferIn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Generic error'),
      );

      const backend = new WebUsbBackend(device);
      await backend.open();

      try {
        await backend.read(64);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UsbTransportError);
        const usbError = error as UsbTransportError;
        expect(usbError.domExceptionName).toBeUndefined();
      }
    });
  });

  describe('interface release on unrecoverable error', () => {
    it('releases interface on read error', async () => {
      const device = createMockUSBDevice();
      (device.transferIn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException('Device disconnected', 'NotFoundError'),
      );

      const backend = new WebUsbBackend(device);
      await backend.open();

      await expect(backend.read(64)).rejects.toThrow(UsbTransportError);
      expect(device.releaseInterface).toHaveBeenCalledWith(0);
    });

    it('releases interface on write error', async () => {
      const device = createMockUSBDevice();
      (device.transferOut as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException('Device disconnected', 'NotFoundError'),
      );

      const backend = new WebUsbBackend(device);
      await backend.open();

      await expect(backend.write(new Uint8Array([1]))).rejects.toThrow(UsbTransportError);
      expect(device.releaseInterface).toHaveBeenCalledWith(0);
    });

    it('does not throw if releaseInterface fails during cleanup', async () => {
      const device = createMockUSBDevice();
      (device.transferIn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException('Device disconnected', 'NotFoundError'),
      );
      (device.releaseInterface as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException('Already released', 'InvalidStateError'),
      );

      const backend = new WebUsbBackend(device);
      await backend.open();

      // Should still throw UsbTransportError (not the cleanup error)
      await expect(backend.read(64)).rejects.toThrow(UsbTransportError);
    });
  });

  describe('getDeviceIds()', () => {
    it('returns vendor and product IDs', () => {
      const device = createMockUSBDevice({ vendorId: 0x054c, productId: 0x0fff });
      const backend = new WebUsbBackend(device);

      const ids = backend.getDeviceIds();
      expect(ids.vendorId).toBe(0x054c);
      expect(ids.productId).toBe(0x0fff);
    });
  });
});
