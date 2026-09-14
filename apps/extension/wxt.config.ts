import { defineConfig } from 'wxt';

const prodPublicKey = process.env.ANNOTATED_PROD_EXTENSION_PUBLIC_KEY?.trim();

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
    // Prod zip packaging sets ANNOTATED_PROD_EXTENSION_PUBLIC_KEY so Load
    // unpacked from extension.zip keeps one chromiumapp.org ID. Local and
    // Staging unpacked builds omit `key` and keep path-derived IDs.
    ...(prodPublicKey ? { key: prodPublicKey } : {}),
  },
});
