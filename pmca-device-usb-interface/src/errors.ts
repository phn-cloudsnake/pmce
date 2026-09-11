/**
 * Error type hierarchy for all PMCA operations.
 *
 * Each error class sets its prototype explicitly via Object.setPrototypeOf
 * to ensure `instanceof` checks work correctly with TypeScript/ES2015+ transpilation.
 */

/** Base error for all PMCA operations */
export class PmcaError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PmcaError';
    Object.setPrototypeOf(this, PmcaError.prototype);
  }
}

/** USB transport errors (WebUSB layer) */
export class UsbTransportError extends PmcaError {
  constructor(
    message: string,
    public readonly domExceptionName?: string,
    cause?: Error,
  ) {
    super(message, cause);
    this.name = 'UsbTransportError';
    Object.setPrototypeOf(this, UsbTransportError.prototype);
  }
}

/** PTP/MTP protocol errors */
export class MtpProtocolError extends PmcaError {
  constructor(message: string, public readonly responseCode: number) {
    super(message);
    this.name = 'MtpProtocolError';
    Object.setPrototypeOf(this, MtpProtocolError.prototype);
  }
}

/** Sony ExtCmd errors */
export class ExtCmdError extends PmcaError {
  constructor(message: string, public readonly responseCode: number) {
    super(message);
    this.name = 'ExtCmdError';
    Object.setPrototypeOf(this, ExtCmdError.prototype);
  }
}

/** Camera returned an invalid/unsupported command */
export class InvalidCommandError extends PmcaError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommandError';
    Object.setPrototypeOf(this, InvalidCommandError.prototype);
  }
}

/** Firmware update specific errors */
export class FirmwareUpdateError extends PmcaError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly statusDescription: string,
  ) {
    super(message);
    this.name = 'FirmwareUpdateError';
    Object.setPrototypeOf(this, FirmwareUpdateError.prototype);
  }
}

/** Timeout errors (device reconnection, busy retries) */
export class TimeoutError extends PmcaError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/** Device not supported or wrong mode */
export class DeviceError extends PmcaError {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceError';
    Object.setPrototypeOf(this, DeviceError.prototype);
  }
}

/** File format parsing errors (SPK) */
export class FormatError extends PmcaError {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
    Object.setPrototypeOf(this, FormatError.prototype);
  }
}
