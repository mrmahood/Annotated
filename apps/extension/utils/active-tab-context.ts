export const ACTIVE_TAB_CONTEXT_KEY = 'annotatedActiveTabContext';
export const ACTIVE_TAB_CONTEXT_MESSAGE = 'annotatedActiveTabContextUpdated';

export type ActiveTabContext = {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  capturedAt: number;
};

export type ActiveTabContextMessage = {
  type: typeof ACTIVE_TAB_CONTEXT_MESSAGE;
  context: ActiveTabContext;
};

export function activeTabContextFromTab(
  tab: {
    id?: number;
    windowId?: number;
    title?: string;
    url?: string;
    favIconUrl?: string;
  },
  capturedAt = Date.now(),
): ActiveTabContext | null {
  if (tab.id == null || tab.windowId == null || !Number.isInteger(tab.id) || tab.id < 0) {
    return null;
  }
  if (!Number.isInteger(tab.windowId) || tab.windowId < 0) {
    return null;
  }
  if (typeof tab.url !== 'string') {
    return null;
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? '',
    url: tab.url,
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
    capturedAt,
  };
}

export function adoptActiveTabContextFromLiveTab(
  context: ActiveTabContext,
  tab: { title?: string; url?: string },
): ActiveTabContext | null {
  if (typeof tab.url !== 'string' || typeof tab.title !== 'string') return null;
  if (context.url === tab.url && context.title === tab.title) return context;
  return {
    ...context,
    title: tab.title,
    url: tab.url,
  };
}

export function contextsDescribeSameTab(
  current: Pick<ActiveTabContext, 'tabId' | 'windowId' | 'title' | 'url'>,
  next: Pick<ActiveTabContext, 'tabId' | 'windowId' | 'title' | 'url'>,
): boolean {
  return (
    current.tabId === next.tabId &&
    current.windowId === next.windowId &&
    current.title === next.title &&
    current.url === next.url
  );
}

export function isActiveTabContext(value: unknown): value is ActiveTabContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const context = value as Partial<ActiveTabContext>;

  return (
    Number.isInteger(context.tabId) &&
    (context.tabId ?? -1) >= 0 &&
    Number.isInteger(context.windowId) &&
    (context.windowId ?? -1) >= 0 &&
    typeof context.title === 'string' &&
    typeof context.url === 'string' &&
    (context.favIconUrl === undefined || typeof context.favIconUrl === 'string') &&
    typeof context.capturedAt === 'number' &&
    Number.isFinite(context.capturedAt)
  );
}

export function isActiveTabContextMessage(
  value: unknown,
): value is ActiveTabContextMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Partial<ActiveTabContextMessage>;

  return (
    message.type === ACTIVE_TAB_CONTEXT_MESSAGE &&
    isActiveTabContext(message.context)
  );
}
