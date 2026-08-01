export default defineBackground(() => {
  const chrome = (globalThis as typeof globalThis & {
    chrome: typeof browser;
  }).chrome;

  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('Unable to enable the Annotated side panel:', error);
    });
});
