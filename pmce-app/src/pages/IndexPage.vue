<template>
  <q-page class="q-pa-lg">
    <div class="text-h5 q-mb-md">Camera Connection</div>

    <q-card flat bordered class="q-mb-lg">
      <q-card-section>
        <div class="row items-center q-gutter-md">
          <q-btn
            color="amber-8"
            text-color="dark"
            label="Connect Camera"
            icon="usb"
            :loading="camera.connecting"
            :disable="camera.connected"
            @click="camera.connect()"
          />
          <q-btn
            v-if="camera.connected"
            flat
            color="negative"
            label="Disconnect"
            icon="usb_off"
            @click="camera.disconnect()"
          />
          <q-chip
            v-if="camera.connected"
            color="positive"
            text-color="white"
            icon="check_circle"
            label="Connected"
          />
          <q-chip
            v-else
            color="grey-7"
            text-color="white"
            icon="usb_off"
            label="Not connected"
          />
        </div>
      </q-card-section>
    </q-card>

    <q-card v-if="camera.cameraInfo" flat bordered>
      <q-card-section>
        <div class="text-h6 q-mb-sm">Camera Information</div>
        <q-list separator>
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
              <q-item-label caption>Firmware Version</q-item-label>
              <q-item-label>{{ camera.cameraInfo.firmwareVersion }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="camera.cameraInfo.lensModel">
            <q-item-section>
              <q-item-label caption>Lens</q-item-label>
              <q-item-label>Model {{ camera.cameraInfo.lensModel }} (Firmware {{ camera.cameraInfo.lensFirmwareVersion }})</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="camera.cameraInfo.gpsDataRange">
            <q-item-section>
              <q-item-label caption>GPS Data Range</q-item-label>
              <q-item-label>{{ formatDate(camera.cameraInfo.gpsDataRange.start) }} — {{ formatDate(camera.cameraInfo.gpsDataRange.end) }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>

    <q-banner v-if="camera.error" class="bg-negative text-white q-mt-md" rounded>
      {{ camera.error }}
    </q-banner>
  </q-page>
</template>

<script setup lang="ts">
import { useCameraStore } from 'src/stores/camera';

const camera = useCameraStore();

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString();
}
</script>
