import type { Intervention } from "@/lib/schemas/intervention";

/**
 * Pure, invertible editor operations. No React or browser APIs, so the model can be
 * tested with properties: applying an operation and then its inverse restores the list.
 */
export type EditorOperation =
  | { type: "add"; feature: Intervention; index: number }
  | { type: "remove"; feature: Intervention; index: number }
  | { type: "update"; before: Intervention; after: Intervention }
  | {
      type: "replace";
      before: readonly Intervention[];
      after: readonly Intervention[];
    };

export type EditorState = {
  readonly features: readonly Intervention[];
  readonly past: readonly EditorOperation[];
  readonly future: readonly EditorOperation[];
};

export const MAX_HISTORY = 100;

export class EditorOperationError extends Error {}

export function createEditorState(
  features: readonly Intervention[],
): EditorState {
  return { features: [...features], past: [], future: [] };
}

export function applyOperation(
  features: readonly Intervention[],
  operation: EditorOperation,
): Intervention[] {
  switch (operation.type) {
    case "add": {
      if (features.some(({ id }) => id === operation.feature.id)) {
        throw new EditorOperationError("Feature id already exists");
      }
      const index = Math.max(0, Math.min(operation.index, features.length));
      return [
        ...features.slice(0, index),
        operation.feature,
        ...features.slice(index),
      ];
    }
    case "remove": {
      if (!features.some(({ id }) => id === operation.feature.id)) {
        throw new EditorOperationError("Feature to remove does not exist");
      }
      return features.filter(({ id }) => id !== operation.feature.id);
    }
    case "update": {
      if (operation.before.id !== operation.after.id) {
        throw new EditorOperationError(
          "An update cannot change the feature id",
        );
      }
      if (!features.some(({ id }) => id === operation.before.id)) {
        throw new EditorOperationError("Feature to update does not exist");
      }
      return features.map((feature) =>
        feature.id === operation.before.id ? operation.after : feature,
      );
    }
    case "replace":
      return [...operation.after];
  }
}

export function invertOperation(operation: EditorOperation): EditorOperation {
  switch (operation.type) {
    case "add":
      return {
        type: "remove",
        feature: operation.feature,
        index: operation.index,
      };
    case "remove":
      return {
        type: "add",
        feature: operation.feature,
        index: operation.index,
      };
    case "update":
      return {
        type: "update",
        before: operation.after,
        after: operation.before,
      };
    case "replace":
      return {
        type: "replace",
        before: operation.after,
        after: operation.before,
      };
  }
}

/** Applies a new user operation, records it for undo, and clears the redo stack. */
export function execute(
  state: EditorState,
  operation: EditorOperation,
): EditorState {
  return {
    features: applyOperation(state.features, operation),
    past: [...state.past, operation].slice(-MAX_HISTORY),
    future: [],
  };
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

export function undo(state: EditorState): EditorState {
  const operation = state.past.at(-1);
  if (!operation) return state;
  return {
    features: applyOperation(state.features, invertOperation(operation)),
    past: state.past.slice(0, -1),
    future: [operation, ...state.future],
  };
}

export function redo(state: EditorState): EditorState {
  const [operation, ...future] = state.future;
  if (!operation) return state;
  return {
    features: applyOperation(state.features, operation),
    past: [...state.past, operation].slice(-MAX_HISTORY),
    future,
  };
}

/** Builds the operation that places a feature at the end of the list. */
export function addOperation(
  features: readonly Intervention[],
  feature: Intervention,
): EditorOperation {
  return { type: "add", feature, index: features.length };
}

export function removeOperation(
  features: readonly Intervention[],
  id: string,
): EditorOperation | null {
  const index = features.findIndex((feature) => feature.id === id);
  const feature = features[index];
  return feature ? { type: "remove", feature, index } : null;
}
