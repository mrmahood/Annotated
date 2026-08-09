export type TopLevelView = 'context' | 'feed' | 'account';

export type PanelScreen =
  | { kind: 'root'; view: TopLevelView }
  | { kind: 'annotation'; annotationId: string }
  | { kind: 'comments'; annotationId: string }
  | { kind: 'profile'; profileId: string };

export type NavigationState = {
  stack: PanelScreen[];
};

export type NavigationAction =
  | { type: 'select-root'; view: TopLevelView }
  | { type: 'push'; screen: Exclude<PanelScreen, { kind: 'root' }> }
  | { type: 'back' };

export const INITIAL_NAVIGATION: NavigationState = {
  stack: [{ kind: 'root', view: 'context' }],
};

export function reduceNavigation(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  if (action.type === 'select-root') {
    return { stack: [{ kind: 'root', view: action.view }] };
  }
  if (action.type === 'back') {
    return state.stack.length > 1
      ? { stack: state.stack.slice(0, -1) }
      : state;
  }
  return { stack: [...state.stack, action.screen] };
}

export function getCurrentScreen(state: NavigationState): PanelScreen {
  return state.stack[state.stack.length - 1] ?? INITIAL_NAVIGATION.stack[0]!;
}

export function getPostPublishNavigation(annotationId: string): NavigationState {
  return {
    stack: [
      { kind: 'root', view: 'context' },
      { kind: 'annotation', annotationId },
    ],
  };
}
