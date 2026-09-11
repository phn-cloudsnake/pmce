import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { PmcaDevice } from 'pmce-usb-interface';
import type { CameraInfo, InstallResult, ProgressEvent, SslProxy } from 'pmce-usb-interface';

/**
 * Create an SslProxy implementation that bridges to the Electron main process
 * via the window.pmcaInstall API exposed by the preload script.
 *
 * Returns undefined if not running in Electron (no proxy available).
 */
function createElectronSslProxy(): SslProxy | undefined {
  const api = window.pmcaInstall;
  if (!api) return undefined;

  return {
    async startServer(spkData: Uint8Array) {
      return api.startServer(Array.from(spkData));
    },

    async connect(connectionId: number, host: string, port: number) {
      await api.socketConnect(connectionId, host, port);
    },

    async send(connectionId: number, data: Uint8Array) {
      await api.socketSend(connectionId, Array.from(data));
    },

    async close(connectionId: number) {
      await api.socketClose(connectionId);
    },

    onData(callback: (connectionId: number, data: Uint8Array) => void) {
      return api.onSocketData((connectionId, dataArray) => {
        callback(connectionId, new Uint8Array(dataArray));
      });
    },

    async stopServer() {
      await api.stopServer();
    },
  };
}

export const useCameraStore = defineStore('camera', () => {
  const device = ref<PmcaDevice | null>(null);
  const cameraInfo = ref<CameraInfo | null>(null);
  const connecting = ref(false);
  const error = ref<string | null>(null);

  // Install state
  const installing = ref(false);
  const installProgress = ref<ProgressEvent | null>(null);
  const installError = ref<string | null>(null);
  const installResult = ref<InstallResult | null>(null);

  const connected = computed(() => device.value !== null);

  async function connect() {
    connecting.value = true;
    error.value = null;
    cameraInfo.value = null;

    try {
      const d = await PmcaDevice.connect();
      device.value = d;
      const info = await d.info();
      cameraInfo.value = info;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      device.value = null;
    } finally {
      connecting.value = false;
    }
  }

  async function disconnect() {
    if (device.value) {
      await device.value.disconnect();
      device.value = null;
    }
    cameraInfo.value = null;
    error.value = null;
  }

  /**
   * Install an APK on the connected camera using the WebUSB device interface directly.
   *
   * Note: After installation, the camera connection is invalidated because the camera
   * reboots into app install mode. The device reference is cleared after install completes.
   *
   * @param apkData - Raw APK file bytes to install.
   */
  async function install(apkData: Uint8Array): Promise<InstallResult | null> {
    if (!device.value) {
      installError.value = 'No camera connected';
      return null;
    }

    installing.value = true;
    installError.value = null;
    installResult.value = null;
    installProgress.value = null;

    try {
      // Create SSL proxy using the Electron IPC bridge (if available)
      const sslProxy = createElectronSslProxy();

      const result = await device.value.install({
        apkData,
        sslProxy,
        onProgress: (event: ProgressEvent) => {
          installProgress.value = { ...event };
        },
      });

      installResult.value = result;

      // After install, the original device connection is gone (camera rebooted)
      device.value = null;
      cameraInfo.value = null;

      return result;
    } catch (err) {
      installError.value = err instanceof Error ? err.message : String(err);
      // Connection is likely dead after a failed install attempt too
      device.value = null;
      cameraInfo.value = null;
      return null;
    } finally {
      installing.value = false;
    }
  }

  function clearInstallState() {
    installError.value = null;
    installResult.value = null;
    installProgress.value = null;
  }

  return {
    device,
    cameraInfo,
    connecting,
    connected,
    error,
    connect,
    disconnect,
    // Install
    installing,
    installProgress,
    installError,
    installResult,
    install,
    clearInstallState,
  };
});
