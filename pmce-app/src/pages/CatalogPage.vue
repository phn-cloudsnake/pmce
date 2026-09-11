<template>
  <q-page class="q-pa-lg">
    <div class="text-h5 q-mb-sm">App Catalog</div>
    <p class="text-grey-5 q-mb-lg">Browse and install PlayMemories Camera Apps on your Sony camera.</p>

    <q-input
      v-model="search"
      outlined
      dense
      placeholder="Search apps..."
      class="q-mb-lg"
      style="max-width: 400px"
    >
      <template #prepend>
        <q-icon name="search" />
      </template>
      <template v-if="search" #append>
        <q-icon name="close" class="cursor-pointer" @click="search = ''" />
      </template>
    </q-input>

    <div class="row q-col-gutter-md">
      <div
        v-for="app in filteredApps"
        :key="app.id"
        class="col-12 col-sm-6 col-md-4 col-lg-3"
      >
        <q-card
          class="app-card cursor-pointer full-height"
          flat
          bordered
          @click="goToApp(app.id)"
        >
          <q-card-section class="q-pb-none">
            <div class="row items-center no-wrap q-gutter-sm">
              <q-avatar rounded size="48px" color="amber-8" text-color="dark" icon="apps" />
              <div class="col">
                <div class="text-subtitle1 text-weight-bold ellipsis">{{ app.name }}</div>
                <div class="text-caption text-grey-5">v{{ app.version }}</div>
              </div>
            </div>
          </q-card-section>

          <q-card-section>
            <p class="text-body2 text-grey-4 app-description">{{ app.description }}</p>
          </q-card-section>

          <q-space />

          <q-card-section class="q-pt-none">
            <div class="row items-center justify-between">
              <q-badge
                :color="app.price === 'Free' || app.price.includes('Free') ? 'positive' : 'grey-7'"
                :label="app.price"
              />
              <span class="text-caption text-grey-5">{{ app.size }}</span>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div v-if="filteredApps.length === 0" class="text-center q-pa-xl text-grey-5">
      <q-icon name="search_off" size="48px" class="q-mb-sm" />
      <div>No apps found matching "{{ search }}"</div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppCatalog } from 'src/composables/useAppCatalog';

const router = useRouter();
const { apps } = useAppCatalog();
const search = ref('');

const filteredApps = computed(() => {
  if (!search.value) return apps.value;
  const q = search.value.toLowerCase();
  return apps.value.filter(
    (app) =>
      app.name.toLowerCase().includes(q) ||
      app.description.toLowerCase().includes(q) ||
      app.cameras.some((c) => c.toLowerCase().includes(q)),
  );
});

function goToApp(id: string) {
  void router.push({ name: 'app-details', params: { id } });
}
</script>

<style scoped lang="scss">
.app-card {
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--q-amber-8);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }
}

.app-description {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 3.6em;
}
</style>
