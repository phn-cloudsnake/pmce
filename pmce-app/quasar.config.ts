import { configure } from 'quasar/wrappers';

export default configure(() => {
  return {
    boot: [],

    css: ['app.scss'],

    extras: ['roboto-font', 'material-icons'],

    build: {
      target: { browser: ['es2022', 'chrome130'], node: 'node20' },
      typescript: { strict: true, vueShim: true },
      vueRouterMode: 'hash',
    },

    devServer: {
      open: false,
    },

    framework: {
      config: {
        dark: true,
      },
      plugins: ['Notify', 'Dialog', 'Loading'],
    },

    animations: [],

    electron: {
      inspectPort: 5858,

      bundler: 'builder',

      extendElectronMainConf(esbuildConf) {
        esbuildConf.format = 'cjs';
      },

      extendElectronPreloadConf(esbuildConf) {
        esbuildConf.format = 'cjs';
      },

      extendPackageJson(pkg) {
        // Remove workspace protocol deps — they are bundled by Vite
        if (pkg.dependencies) {
          delete pkg.dependencies['pmce-usb-interface'];
        }
      },

      builder: {
        appId: 'com.homa.pmce',
        productName: 'PMCE',
        electronVersion: '33.4.11',
        mac: {
          target: 'dmg',
          icon: 'public/icons/ios/Icon-1024x1024.png',
        },
        win: {
          target: 'nsis',
          icon: 'public/icons/ios/Icon-256x256.png',
        },
        linux: {
          target: 'AppImage',
          icon: 'public/icons/ios/Icon-512x512.png',
        },
      },
    },
  };
});
