import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import { registerInstallIpc } from './install-ipc';

// Allow legacy TLS for the local market server (Sony cameras use TLS 1.0)
// This only affects Node.js connections within the main process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Remove the WebUSB protected interface class restriction.
// MTP/PTP (imaging class 6) is blocked by default in Chromium — this bypasses it
// so we can communicate with Sony cameras via their MTP interface.
app.commandLine.appendSwitch('disable-usb-guard');

// Register IPC handlers for app installation
registerInstallIpc();

const currentDir = __dirname;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER ?? 'preload',
          'electron-preload' + (process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION ?? '.cjs'),
        ),
      ),
    },
  });

  // WebUSB device selection: auto-select Sony cameras
  let usbCallback: ((deviceId?: string) => void) | null = null;

  mainWindow.webContents.session.on(
    'select-usb-device',
    (event, details, callback) => {
      event.preventDefault();

      // Store callback for usb-device-added events
      usbCallback = callback;

      const sonyDevice = details.deviceList.find((d) => d.vendorId === 0x054c);
      if (sonyDevice) {
        usbCallback = null;
        callback(sonyDevice.deviceId);
      } else if (details.deviceList.length > 0) {
        usbCallback = null;
        callback(details.deviceList[0].deviceId);
      }
      // If no devices found, wait for usb-device-added
    },
  );

  mainWindow.webContents.session.on('usb-device-added', (event, device) => {
    if (usbCallback && device.vendorId === 0x054c) {
      const cb = usbCallback;
      usbCallback = null;
      cb(device.deviceId);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      if (permission === 'usb') return true;
      return true;
    },
  );

  // Allow access to all USB interface classes (MTP/PTP imaging class is protected by default)
  mainWindow.webContents.session.setUSBProtectedClassesHandler(() => {
    // Return empty array = no classes are protected = allow claiming any interface
    return [];
  });

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb') {
      return (details.device as { vendorId?: number }).vendorId === 0x054c;
    }
    return false;
  });

  if (process.env.DEV) {
    mainWindow.loadURL(process.env.APP_URL!);
  } else {
    mainWindow.loadFile('index.html');
  }

  if (process.env.DEBUGGING) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (os.platform() !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
