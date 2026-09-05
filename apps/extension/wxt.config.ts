import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Annotated',
    description: 'Annotate and organize sources from the web.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'activeTab', 'storage', 'scripting', 'identity', 'tabCapture', 'offscreen', 'tabs'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open Annotated',
    },
  },
});
