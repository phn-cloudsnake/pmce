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
  apkFile: string;
}

interface AppsYaml {
  apps: AppEntry[];
}

const catalog = ref<AppEntry[]>([]);
let loaded = false;

function loadCatalog(): void {
  if (loaded) return;
  const data = parse(appsYamlRaw) as AppsYaml;
  catalog.value = data.apps;
  loaded = true;
}

export function useAppCatalog() {
  loadCatalog();

  const apps = computed(() => catalog.value);

  function getAppById(id: string): AppEntry | undefined {
    return catalog.value.find((app) => app.id === id);
  }

  return { apps, getAppById };
}
