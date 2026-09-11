import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonyExtCmdProtocol } from './sony-ext-cmd-protocol.js';
import { ExtCmdError, InvalidCommandError, TimeoutError } from '../errors.js';
import {
  PTP_RC_OK,
  PTP_RC_DeviceBusy,
  PTP_RC_ParameterNotSupported,
  EXTCMD_MAX_BUSY_RETRIES,
} from '../constants.js';
import type { MtpDriver } from './mtp-driver.js';

/**
 * Creates a mock MtpDriver with configurable response codes.
 */
function createMockDriver(options?: {
  writeResponses?: number[];
  readResponseCode?: number;
  readResponseCodes?: number[];
  readData?: Uint8Array;
}) {
  const writeResponses = options?.writeResponses ?? [PTP_RC_OK];
  const readResponseCodes = options?.readResponseCodes ?? [options?.readResponseCode ?? PTP_RC_OK];
  const readData = options?.readData ?? new Uint8Array(16); // Minimal response with zeroed header

  let writeCallCount = 0;
  let readCallCount = 0;

  const mockDriver = {
    sendWriteCommand: vi.fn(async () => {
      const code = writeResponses[Math.min(writeCallCount, writeResponses.length - 1)];
      writeCallCount++;
      return code;
    }),
    sendReadCommand: vi.fn(async () => {
      const code = readResponseCodes[Math.min(readCallCount, readResponseCodes.length - 1)];
      readCallCount++;
      return { responseCode: code, data: readData };
    }),
    get writeCallCount() {
      return writeCallCount;
    },
    get readCallCount() {
      return readCallCount;
    },
  } as unknown as MtpDriver & { writeCallCount: number; readCallCount: number };

  return mockDriver;
}

describe('SonyExtCmdProtocol', () => {
  describe('busy-retry during write phase', () => {
    it('retries on DeviceBusy and succeeds on Nth attempt', async () => {
      // Return busy 5 times, then OK
      const writeResponses = [
        ...Array(5).fill(PTP_RC_DeviceBusy),
        PTP_RC_OK,
      ];
      const driver = createMockDriver({ writeResponses });
      const protocol = new SonyExtCmdProtocol(driver);

      const result = await protocol.sendCommand(1, 1);

      expect(driver.sendWriteCommand).toHaveBeenCalledTimes(6);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('throws TimeoutError after 100 busy responses', async () => {
      const writeResponses = Array(EXTCMD_MAX_BUSY_RETRIES).fill(PTP_RC_DeviceBusy);
      const driver = createMockDriver({ writeResponses });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(TimeoutError);
      expect(driver.sendWriteCommand).toHaveBeenCalledTimes(EXTCMD_MAX_BUSY_RETRIES);
    });

    it('throws InvalidCommandError on ParameterNotSupported (0x2006)', async () => {
      const driver = createMockDriver({
        writeResponses: [PTP_RC_ParameterNotSupported],
      });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(InvalidCommandError);
      expect(driver.sendWriteCommand).toHaveBeenCalledTimes(1);
    });

    it('throws ExtCmdError on unexpected response code (0x2002)', async () => {
      const unexpectedCode = 0x2002;
      const driver = createMockDriver({
        writeResponses: [unexpectedCode],
      });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(ExtCmdError);
      expect(driver.sendWriteCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('busy-retry during read phase', () => {
    it('retries on DeviceBusy and succeeds on Nth attempt', async () => {
      // Write succeeds immediately; read busy 3 times then OK
      const readResponseCodes = [
        ...Array(3).fill(PTP_RC_DeviceBusy),
        PTP_RC_OK,
      ];
      // Build a valid read response with a minimal header (dataSize=0)
      const readData = new Uint8Array(16); // all zeros => dataSize=0
      const driver = createMockDriver({
        writeResponses: [PTP_RC_OK],
        readResponseCodes,
        readData,
      });
      const protocol = new SonyExtCmdProtocol(driver);

      const result = await protocol.sendCommand(1, 1);

      expect(driver.sendReadCommand).toHaveBeenCalledTimes(4);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('throws TimeoutError after 100 busy responses', async () => {
      const readResponseCodes = Array(EXTCMD_MAX_BUSY_RETRIES).fill(PTP_RC_DeviceBusy);
      const driver = createMockDriver({
        writeResponses: [PTP_RC_OK],
        readResponseCodes,
      });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(TimeoutError);
      expect(driver.sendReadCommand).toHaveBeenCalledTimes(EXTCMD_MAX_BUSY_RETRIES);
    });

    it('throws InvalidCommandError on ParameterNotSupported (0x2006)', async () => {
      const driver = createMockDriver({
        writeResponses: [PTP_RC_OK],
        readResponseCodes: [PTP_RC_ParameterNotSupported],
      });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(InvalidCommandError);
      expect(driver.sendReadCommand).toHaveBeenCalledTimes(1);
    });

    it('throws ExtCmdError on unexpected response code', async () => {
      const unexpectedCode = 0x2002;
      const driver = createMockDriver({
        writeResponses: [PTP_RC_OK],
        readResponseCodes: [unexpectedCode],
      });
      const protocol = new SonyExtCmdProtocol(driver);

      await expect(protocol.sendCommand(1, 1)).rejects.toThrow(ExtCmdError);
      expect(driver.sendReadCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('readBufferSize = 0 (skip read phase)', () => {
    it('returns empty Uint8Array and does not call sendReadCommand', async () => {
      const driver = createMockDriver({ writeResponses: [PTP_RC_OK] });
      const protocol = new SonyExtCmdProtocol(driver);

      const result = await protocol.sendCommand(1, 1, new Uint8Array(0), 0x2000, 0);

      expect(result).toEqual(new Uint8Array(0));
      expect(driver.sendReadCommand).not.toHaveBeenCalled();
    });
  });
});
