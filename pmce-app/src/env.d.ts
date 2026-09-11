/* eslint-disable */

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

declare module '*.yml?raw' {
  const content: string;
  export default content;
}

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

/** Install proxy API exposed by Electron preload script. */
interface PmcaInstallApi {
  startServer(spkData: number[]): Promise<{ port: number; url: string }>;
  stopServer(): Promise<void>;
  socketConnect(connectionId: number, host: string, port: number): Promise<void>;
  socketSend(connectionId: number, data: number[]): Promise<void>;
  socketClose(connectionId: number): Promise<void>;
  onSocketData(callback: (connectionId: number, data: number[]) => void): () => void;
  onSocketEnd(callback: (connectionId: number) => void): () => void;
}

interface Window {
  pmcaInstall?: PmcaInstallApi;
}
