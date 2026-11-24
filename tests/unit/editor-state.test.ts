import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDefaultIntervention } from "@/features/editor/defaults";
import {
  addOperation,
  applyOperation,
  canRedo,
  canUndo,
  createEditorState,
  EditorOperationError,
  execute,
  invertOperation,
  MAX_HISTORY,
  redo,
  removeOperation,
  undo,
  type EditorOperation,
  type EditorState,
} from "@/features/editor/editor-state";
import { editableKinds, type Intervention } from "@/lib/schemas/intervention";

const SEED = 20260514;
const labels = { label: "Elemento", timeSlot: "Sábados" };

const interventionArb: fc.Arbitrary<Intervention> = fc
  .record({
    id: fc.uuid(),
    kind: fc.constantFrom(...editableKinds),
    lon: fc.integer({ min: -9_000_000, max: 9_000_000 }),
    lat: fc.integer({ min: -4_000_000, max: 4_000_000 }),
  })
  .map(({ id, kind, lon, lat }) =>
    createDefaultIntervention(kind, id, [lon / 100_000, lat / 100_000], labels),
  );

const initialArb = fc.uniqueArray(interventionArb, {
  selector: ({ id }) => id,
  maxLength: 6,
});

type Command =
  | { type: "add"; feature: Intervention; at: number }
  | { type: "remove"; at: number }
  | { type: "update"; at: number; kind: Intervention["kind"] }
  | { type: "replace"; next: Intervention[] };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    type: fc.constant("add" as const),
    feature: interventionArb,
    at: fc.nat(10),
  }),
  fc.record({ type: fc.constant("remove" as const), at: fc.nat(10) }),
  fc.record({
    type: fc.constant("update" as const),
    at: fc.nat(10),
    // Only the label changes: kind and id stay equal.
    kind: fc.constantFrom(...editableKinds),
  }),
  fc.record({
    type: fc.constant("replace" as const),
    next: fc.uniqueArray(interventionArb, {
      selector: ({ id }) => id,
      maxLength: 4,
    }),
  }),
);

/** Builds a valid operation for the current list, or null if the command does not apply. */
function toOperation(
  features: readonly Intervention[],
  command: Command,
): EditorOperation | null {
  switch (command.type) {
    case "add":
      if (features.some(({ id }) => id === command.feature.id)) return null;
      return { type: "add", feature: command.feature, index: command.at };
    case "remove": {
      if (features.length === 0) return null;
      return removeOperation(
        features,
        features[command.at % features.length].id,
      );
    }
    case "update": {
      if (features.length === 0) return null;
      const before = features[command.at % features.length];
      const after = {
        ...before,
        properties: {
          ...before.properties,
          label: `${before.properties.label}!`,
        },
      } as Intervention;
      return { type: "update", before, after };
    }
    case "replace":
      return { type: "replace", before: features, after: command.next };
  }
}

function run(initial: Intervention[], commands: Command[]) {
  let state = createEditorState(initial);
  const snapshots: (readonly Intervention[])[] = [state.features];
  for (const command of commands) {
    const operation = toOperation(state.features, command);
    if (!operation) continue;
    state = execute(state, operation);
    snapshots.push(state.features);
  }
  return { state, snapshots };
}

describe("editor-state (propiedades)", () => {
  it("deshacer N veces restaura la lista inicial y rehacer N veces reproduce el estado final", () => {
    fc.assert(
      fc.property(
        initialArb,
        fc.array(commandArb, { maxLength: 25 }),
        (initial, commands) => {
          const { state: finalState, snapshots } = run(initial, commands);
          const count = finalState.past.length;
          expect(count).toBe(snapshots.length - 1);

          let state: EditorState = finalState;
          for (let step = count - 1; step >= 0; step -= 1) {
            state = undo(state);
            expect(state.features).toEqual(snapshots[step]);
          }
          expect(state.features).toEqual(initial);
          expect(canUndo(state)).toBe(false);

          for (let step = 1; step <= count; step += 1) {
            state = redo(state);
            expect(state.features).toEqual(snapshots[step]);
          }
          expect(state.features).toEqual(finalState.features);
          expect(canRedo(state)).toBe(false);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("una operación nueva después de deshacer vacía future", () => {
    fc.assert(
      fc.property(
        initialArb,
        fc.array(commandArb, { minLength: 1, maxLength: 10 }),
        interventionArb,
        (initial, commands, extra) => {
          const { state } = run(initial, commands);
          fc.pre(state.past.length > 0);
          const undone = undo(state);
          expect(canRedo(undone)).toBe(true);
          fc.pre(!undone.features.some(({ id }) => id === extra.id));
          const next = execute(undone, addOperation(undone.features, extra));
          expect(next.future).toEqual([]);
          expect(canRedo(next)).toBe(false);
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("applyOperation seguido de invertOperation restaura la lista", () => {
    fc.assert(
      fc.property(initialArb, commandArb, (initial, command) => {
        const operation = toOperation(initial, command);
        fc.pre(operation !== null);
        const applied = applyOperation(initial, operation!);
        const restored = applyOperation(applied, invertOperation(operation!));
        expect(restored).toEqual(initial);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe("editor-state (errores y límites)", () => {
  const a = createDefaultIntervention(
    "shade_tree",
    crypto.randomUUID(),
    [0, 0],
    labels,
  );

  it("rechaza add con un id que ya existe", () => {
    expect(() =>
      applyOperation([a], { type: "add", feature: a, index: 0 }),
    ).toThrow(EditorOperationError);
  });

  it("rechaza update que cambia el id", () => {
    const other = { ...a, id: crypto.randomUUID() } as Intervention;
    expect(() =>
      applyOperation([a], { type: "update", before: a, after: other }),
    ).toThrow(EditorOperationError);
  });

  it("rechaza remove y update de elementos inexistentes", () => {
    expect(() =>
      applyOperation([], { type: "remove", feature: a, index: 0 }),
    ).toThrow(EditorOperationError);
    expect(() =>
      applyOperation([], { type: "update", before: a, after: a }),
    ).toThrow(EditorOperationError);
  });

  it("limita el historial a MAX_HISTORY operaciones", () => {
    let state = createEditorState([]);
    for (let i = 0; i < MAX_HISTORY + 20; i += 1) {
      const feature = createDefaultIntervention(
        "shade_tree",
        crypto.randomUUID(),
        [0, 0],
        labels,
      );
      state = execute(state, addOperation(state.features, feature));
    }
    expect(state.past).toHaveLength(MAX_HISTORY);
    expect(state.features).toHaveLength(MAX_HISTORY + 20);
  });

  it("undo y redo sin historial devuelven el mismo estado", () => {
    const state = createEditorState([a]);
    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });
});
