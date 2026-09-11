<template>
  <q-page class="q-pa-lg">
    <!-- Breadcrumb -->
    <div class="text-caption text-grey-5 q-mb-md">
      <router-link to="/catalog" class="text-amber-8 no-decoration">App Catalog</router-link>
      <q-icon name="chevron_right" size="xs" class="q-mx-xs" />
      <span>{{ app?.name ?? 'Unknown' }}</span>
    </div>

    <div v-if="!app" class="text-center q-pa-xl">
      <q-icon name="error_outline" size="64px" color="negative" />
      <div class="text-h6 q-mt-md">App not found</div>
      <q-btn flat color="amber-8" label="Back to Catalog" to="/catalog" class="q-mt-md" />
    </div>

    <div v-else class="row q-col-gutter-lg">
      <!-- LEFT COLUMN: Image + Description -->
      <div class="col-12 col-lg-7">
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <div class="row items-center q-gutter-md">
              <q-avatar rounded size="64px" color="amber-8" text-color="dark" icon="apps" />
              <div>
                <div class="text-h5 text-weight-bold">{{ app.name }}</div>
                <div class="text-caption text-grey-5">{{ app.packageName }}</div>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle2 text-grey-4 q-mb-sm">About this App</div>
            <p class="text-body1 text-grey-3">{{ app.description }}</p>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle2 text-grey-4 q-mb-sm">Compatible Cameras</div>
            <div class="q-gutter-xs">
              <q-badge
                v-for="cam in app.cameras"
                :key="cam"
                :outline="cameraModelName !== cam"
                color="amber-8"
                :label="cam"
                class="q-pa-xs"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- RIGHT COLUMN: Install panel -->
      <div class="col-12 col-lg-5">
        <q-card flat bordered class="sticky-panel">
          <q-card-section>
            <div class="text-h6 text-weight-bold q-mb-md">
              {{ app.name }}
              <span class="text-caption text-grey-5 q-ml-sm">v{{ app.version }}</span>
            </div>

            <q-list dense class="q-mb-md">
              <q-item>
                <q-item-section side>
                  <q-icon name="storage" color="grey-5" size="sm" />
                </q-item-section>
                <q-item-section>
                  <q-item-label caption>Space Required</q-item-label>
                  <q-item-label>{{ app.size }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section side>
                  <q-icon name="sell" color="grey-5" size="sm" />
                </q-item-section>
                <q-item-section>
                  <q-item-label caption>Price</q-item-label>
                  <q-item-label>{{ app.price }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>

            <q-separator class="q-my-md" />

            <!-- Camera connection status -->
            <div class="q-mb-md">
              <div class="row items-center q-gutter-sm q-mb-sm">
                <span class="text-subtitle2">Camera</span>
                <q-badge
                  :color="camera.connected ? 'positive' : 'negative'"
                  :label="camera.connected ? 'CONNECTED' : 'DISCONNECTED'"
                />
              </div>

              <div v-if="!camera.connected" class="q-mb-sm">
                <q-btn
                  outline
                  color="amber-8"
                  label="Connect Camera"
                  icon="usb"
                  size="sm"
                  :loading="camera.connecting"
                  @click="camera.connect()"
                />
              </div>

              <q-list v-if="camera.cameraInfo" dense>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Model</q-item-label>
                    <q-item-label>{{ camera.cameraInfo.modelName }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Product Code</q-item-label>
                    <q-item-label>{{ camera.cameraInfo.modelCode }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Serial Number</q-item-label>
                    <q-item-label>{{ camera.cameraInfo.serialNumber }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item v-if="camera.cameraInfo.firmwareVersion">
                  <q-item-section>
                    <q-item-label caption>Firmware</q-item-label>
                    <q-item-label>{{ camera.cameraInfo.firmwareVersion }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item v-if="camera.cameraInfo.lensModel">
                  <q-item-section>
                    <q-item-label caption>Lens</q-item-label>
                    <q-item-label>{{ camera.cameraInfo.lensModel }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>

            <q-separator class="q-my-md" />

            <!-- Install progress -->
            <div v-if="camera.installing" class="q-mb-md">
              <q-linear-progress
                :value="(camera.installProgress?.percent ?? 0) / 100"
                color="amber-8"
                track-color="grey-8"
                class="q-mb-sm"
              />
              <div class="text-caption text-grey-5">
                {{ camera.installProgress?.operation || 'Installing...' }}
                <span v-if="camera.installProgress?.percent">— {{ camera.installProgress.percent }}%</span>
              </div>
            </div>

            <!-- Install button -->
            <q-btn
              color="positive"
              label="Install App"
              icon="download"
              class="full-width"
              size="lg"
              :loading="camera.installing || loadingApk"
              :disable="!camera.connected"
              @click="installApp"
            />

            <div v-if="!camera.connected" class="text-caption text-grey-6 q-mt-sm text-center">
              Connect a camera first to install apps
            </div>

            <q-banner v-if="camera.installError" class="bg-negative text-white q-mt-md" rounded dense>
              {{ camera.installError }}
            </q-banner>

            <q-banner v-if="camera.installResult?.code === 0" class="bg-positive text-white q-mt-md" rounded dense>
              App installed successfully!
            </q-banner>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useAppCatalog } from 'src/composables/useAppCatalog';
import { useCameraStore } from 'src/stores/camera';

const route = useRoute();
const { getAppById } = useAppCatalog();
const camera = useCameraStore();

const app = computed(() => getAppById(route.params.id as string));
const cameraModelName = computed(() => camera?.cameraInfo?.modelName ?? '')
const loadingApk = ref(false);

async function installApp() {
  if (!app.value || !camera.connected) return;

  camera.clearInstallState();
  loadingApk.value = true;

  try {
    // Fetch the APK from the bundled apps/ directory.
    // Use Vite's BASE_URL so the path resolves correctly both under the dev
    // server (served from "/") and in the packaged Electron app (loaded via
    // the file:// protocol, where an absolute "/apps/..." path would resolve
    // to the filesystem root instead of the app bundle).
    const apkUrl = new URL(
      `${import.meta.env.BASE_URL}apps/${app.value.apkFile}`,
      window.location.href,
    ).href;
    const response = await fetch(apkUrl);
    if (!response.ok) {
      throw new Error(`Failed to load APK file: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const apkData = new Uint8Array(buffer);

    loadingApk.value = false;

    // Install directly via WebUSB device interface
    await camera.install(apkData);
  } catch (err) {
    camera.installError = err instanceof Error ? err.message : String(err);
  } finally {
    loadingApk.value = false;
  }
}

onBeforeUnmount(() => {
  camera.clearInstallState();
});
</script>

<style scoped lang="scss">
.sticky-panel {
  position: sticky;
  top: 70px;
}

.no-decoration {
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}
</style>
