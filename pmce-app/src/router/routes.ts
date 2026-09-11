import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('src/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('src/pages/IndexPage.vue') },
      { path: 'catalog', name: 'catalog', component: () => import('src/pages/CatalogPage.vue') },
      { path: 'catalog/:id', name: 'app-details', component: () => import('src/pages/AppDetailsPage.vue') },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/ErrorNotFound.vue'),
  },
];

export default routes;
