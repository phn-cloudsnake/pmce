/**
 * Protocol constants for the PMCA TypeScript library.
 *
 * Constants are organized by protocol layer: PTP/MTP transport,
 * Sony ExtCmd, App Install, Updater, and SPK format.
 */

// =============================================================================
// PTP/MTP Protocol Constants
// =============================================================================

/** PTP packet header size in bytes (size + type + code + transaction). */
export const PTP_HEADER_SIZE = 12;

/** PTP packet type: Command request. */
export const PTP_TYPE_COMMAND = 1;

/** PTP packet type: Data payload. */
export const PTP_TYPE_DATA = 2;

/** PTP packet type: Response. */
export const PTP_TYPE_RESPONSE = 3;

/** Maximum USB packet length for PTP (triggers multi-read if exceeded). */
export const PTP_MAX_PKG_LEN = 512;

/** PTP response code: OK (success). */
export const PTP_RC_OK = 0x2001;

/** PTP response code: Session not open. */
export const PTP_RC_SessionNotOpen = 0x2003;

/** PTP response code: Parameter not supported (triggers InvalidCommandError). */
export const PTP_RC_ParameterNotSupported = 0x2006;

/** PTP response code: Device busy (triggers retry). */
export const PTP_RC_DeviceBusy = 0x2019;

/** PTP response code: Session already opened. */
export const PTP_RC_SessionAlreadyOpened = 0x201e;

/** PTP operation code: Get device info. */
export const PTP_OC_GetDeviceInfo = 0x1001;

/** PTP operation code: Open session. */
export const PTP_OC_OpenSession = 0x1002;

/** PTP operation code: Close session. */
export const PTP_OC_CloseSession = 0x1003;

// =============================================================================
// Sony Extended Command (ExtCmd) Constants
// =============================================================================

/** Sony USB vendor ID. */
export const SONY_VENDOR_ID = 0x054c;

/** Sony MTP operation code: ExtCmd write. */
export const PTP_OC_SonyDiExtCmd_write = 0x9280;

/** Sony MTP operation code: ExtCmd read. */
export const PTP_OC_SonyDiExtCmd_read = 0x9281;

/** Sony MTP operation code: Request reconnect (mode switch). */
export const PTP_OC_SonyReqReconnect = 0x9282;

/** ExtCmd header size in bytes. */
export const EXTCMD_HEADER_SIZE = 16;

/** Default write buffer size for ExtCmd operations. */
export const EXTCMD_WRITE_BUFFER_SIZE = 0x2000;

/** Default read buffer size for ExtCmd operations. */
export const EXTCMD_READ_BUFFER_SIZE = 0x2000;

/** Maximum number of busy-retry attempts before timeout. */
export const EXTCMD_MAX_BUSY_RETRIES = 100;

// =============================================================================
// App Install Protocol Constants
// =============================================================================

/** Get proxy message info (read message metadata). */
export const PTP_OC_GetProxyMessageInfo = 0x9488;

/** Get proxy message (read message data). */
export const PTP_OC_GetProxyMessage = 0x9489;

/** Send proxy message info (write message metadata). */
export const PTP_OC_SendProxyMessageInfo = 0x948c;

/** Send proxy message (write message data). */
export const PTP_OC_SendProxyMessage = 0x948d;

/**
 * HMAC-SHA256 key used to compute the CIC (Content Integrity Check) field in XPD files.
 * Extracted from ScalarAMarket.apk/lib/libscalaramarket-jni.so and ScalarAUsbDlApp.apk/lib/libjniusbdluser.so.
 */
export const XPD_CIC_KEY = '8595e68aa50d25dcc52b4d6e6a62af526efd7523a4cc47e212e82e979728d6f0dd02c7e4e79ddb317d56fea2bd';

/** XPD INI section name. */
export const XPD_SECTION_NAME = 'DrmTCD';

// =============================================================================
// Updater Protocol Constants
// =============================================================================

/** Updater command: Initialize. */
export const CMD_INIT = 0x1;

/** Updater command: Query firmware version. */
export const CMD_QUERY_VERSION = 0x20;

/** Updater protocol version. */
export const UPDATER_PROTOCOL_VERSION = 0x100;

/** Updater response: OK. */
export const UPDATER_ERR_OK = 0x1;

/** Updater response: Sequence error. */
export const UPDATER_ERR_SEQUENCE = 0x101;

/** Default updater buffer size for command packets. */
export const UPDATER_BUFFER_SIZE = 512;

// =============================================================================
// SPK Format Constants
// =============================================================================

/** SPK file magic bytes: "1spk" in ASCII. */
export const SPK_MAGIC = new Uint8Array([0x31, 0x73, 0x70, 0x6b]);

/** SPK encryption block size: 1 MB. */
export const SPK_BLOCK_SIZE = 0x100000;

/** SPK PKCS#7 padding alignment in bytes. */
export const SPK_PADDING_SIZE = 16;

// =============================================================================
// GPS Assist Data Constants
// =============================================================================

/** GPS epoch: January 6, 1980. Used to decode the camera's GPS data range in info(). */
export const GPS_EPOCH = new Date(1980, 0, 6);

// =============================================================================
// USB Endpoint Constants
// =============================================================================

/** USB endpoint direction mask (bit 7). */
export const USB_ENDPOINT_MASK = 0x80;

/** USB endpoint direction: OUT (host to device). */
export const USB_ENDPOINT_OUT = 0x00;

/** USB endpoint direction: IN (device to host). */
export const USB_ENDPOINT_IN = 0x80;

/** USB default transfer timeout in milliseconds. */
export const USB_DEFAULT_TIMEOUT = 5000;

/** Maximum USB transfer size per operation in bytes. */
export const USB_MAX_TRANSFER_SIZE = 65536;

// =============================================================================
// Sony ExtCmd Group/Command IDs
// =============================================================================

/** ExtCmd: DevInfoSender - Get model info. */
export const SONY_CMD_DevInfoSender_GetModelInfo: [number, number] = [1, 1];

/** ExtCmd: DevInfoSender - Get supported command IDs. */
export const SONY_CMD_DevInfoSender_GetSupportedCommandIds: [number, number] = [1, 2];

/** ExtCmd: KikiLogSender - Init kiki log. */
export const SONY_CMD_KikiLogSender_InitKikiLog: [number, number] = [2, 1];

/** ExtCmd: KikiLogSender - Read kiki log. */
export const SONY_CMD_KikiLogSender_ReadKikiLog: [number, number] = [2, 2];

/** ExtCmd: GpsAssist - Init GPS (used by info() to read the GPS data range). */
export const SONY_CMD_GpsAssist_InitGps: [number, number] = [3, 1];

/** ExtCmd: ScalarExtCmdPlugIn - Get supported command IDs. */
export const SONY_CMD_ScalarExtCmdPlugIn_GetSupportedCommandIds: [number, number] = [5, 1];

/** ExtCmd: ScalarExtCmdPlugIn - Notify scalar download mode (switch to app install). */
export const SONY_CMD_ScalarExtCmdPlugIn_NotifyScalarDlmode: [number, number] = [5, 2];

/** ExtCmd: LensCommunicator - Get supported command IDs. */
export const SONY_CMD_LensCommunicator_GetSupportedCommandIds: [number, number] = [6, 1];

/** ExtCmd: LensCommunicator - Get mounted lens info. */
export const SONY_CMD_LensCommunicator_GetMountedLensInfo: [number, number] = [6, 2];

// =============================================================================
// Sony Updater ExtCmd Group ID
// =============================================================================

/** ExtCmd group ID for the updater protocol. */
export const SONY_CMD_Updater = 0;
