<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-dark">
      <q-toolbar>
        <q-toolbar-title>
          <router-link to="/" class="text-amber no-decoration text-weight-bold">PMCE</router-link>
          <span class="text-grey-5 text-caption q-ml-sm">Play Memories Community Edition</span>
        </q-toolbar-title>

        <q-tabs align="right" narrow-indicator class="text-grey-4">
          <q-route-tab to="/" label="Camera" icon="usb" exact />
          <q-route-tab to="/catalog" label="App Catalog" icon="apps" />
        </q-tabs>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.no-decoration {
  text-decoration: none;
}
</style>
