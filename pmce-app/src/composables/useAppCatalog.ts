import { ref, computed } from 'vue';
import { parse } from 'yaml';
import appsYamlRaw from 'src/assets/apps.yml?raw';

export interface AppEntry {
  id: string;
  name: string;
  packageName: string;
  version: string;
  size: string;
  price: string;
  description: string;
  cameras: string[];
  apkFile?: string;
  apkURL?: string;
}

interface AppsYaml {
  apps: AppEntry[];
}

const catalog = ref<AppEntry[]>([]);
let loaded = false;

async function loadCatalog(): Promise<void> {
  if (loaded) return;
  const {apps} = parse(appsYamlRaw) as AppsYaml;
  console.log(apps)
  const jpegcam = apps.find((app) => app.id === 'jpegcam')
  if(jpegcam) {
    await fetchJPEGCAMLatestBuild(jpegcam)
  }

  catalog.value = apps;
  loaded = true;
}

async function fetchJPEGCAMLatestBuild(jpegcam:AppEntry) {
  const resp = await fetch('https://jpegcookbook.com/jpegcam-release.json')
  const {version, build} = await resp.json()
  jpegcam.version = version
  jpegcam.apkURL = `https://get.jpeg.cam/JPEGCAM-v${version}.apk?build=${build}`  
}

export function useAppCatalog() {
  loadCatalog();

  const apps = computed(() => catalog.value);

  function getAppById(id: string): AppEntry | undefined {
    return catalog.value.find((app) => app.id === id);
  }

  return { apps, getAppById };
}
