/**
 * Abstract USB transport interface.
 *
 * Any USB backend (WebUSB, Node.js `usb`, mock for testing) must
 * implement this interface to be used with the MTP protocol driver.
 */

export interface UsbTransport {
  /** Read up to `length` bytes from the device. */
  read(length: number): Promise<Uint8Array>;

  /** Write `data` to the device. */
  write(data: Uint8Array): Promise<void>;
}
