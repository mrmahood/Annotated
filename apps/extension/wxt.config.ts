import { defineConfig } from 'wxt';

const prodPublicKey = process.env.ANNOTATED_PROD_EXTENSION_PUBLIC_KEY?.trim();

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Annotated',
    description:
      'Source-linked margin notes on articles, plus short video and audio clips from the current tab.',
    minimum_chrome_version: '116',
    // Voice-note getUserMedia uses the extension origin's site permission.
    // Chrome has no MV3 manifest `microphone` key; a capture warning would not
    // improve the in-panel prompt or chrome://settings reconnect path.
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
