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
