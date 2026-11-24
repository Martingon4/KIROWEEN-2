import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * Pure reference model of the dossier state machine. It documents the rules that the
 * SQL enforces (pgTAP 021 checks the SQL itself); it imports no application code, so
 * a change in the SQL rules is caught by pgTAP and a change in the documented rules
 * is caught here.
 *
 *   en_revision -> planeado -> en_ejecucion -> ejecutado
 *   descartado is reachable from en_revision, planeado and en_ejecucion
 *   ejecutado and descartado are closed
 *
 *   planeado      needs responsible + at least one milestone + note
 *   en_ejecucion  needs note + at least one cited evidence
 *   ejecutado     needs observation + difference + at least one cited evidence
 *                 that was NOT cited when execution started
 *   descartado    needs a reason (the note)
 *
 * Property seed: 20260514, 500 runs per property.
 */
const SEED = 20260514;
const RUNS = 500;

type Status =
  | "en_revision"
  | "planeado"
  | "en_ejecucion"
  | "ejecutado"
  | "descartado";
const ALL: Status[] = [
  "en_revision",
  "planeado",
  "en_ejecucion",
  "ejecutado",
  "descartado",
];
const GRAPH: Record<Status, Status[]> = {
  en_revision: ["planeado", "descartado"],
  planeado: ["en_ejecucion", "descartado"],
  en_ejecucion: ["ejecutado", "descartado"],
  ejecutado: [],
  descartado: [],
};
const FORWARD: Partial<Record<Status, Status>> = {
  en_revision: "planeado",
  planeado: "en_ejecucion",
  en_ejecucion: "ejecutado",
};

type Model = {
  status: Status;
  responsible: string | null;
  milestones: number;
  evidence: string[];
  /** Evidence ids cited by the transition into en_ejecucion. */
  startEvidence: string[];
  /** Evidence ids cited by the transition into ejecutado. */
  finishEvidence: string[];
  accepted: { from: Status; to: Status }[];
};

type TransitionInput = {
  expectedState: Status;
  newState: Status;
  note: string | null;
  observation: string | null;
  difference: string | null;
  evidenceIds: string[];
};

const initial = (): Model => ({
  status: "en_revision",
  responsible: null,
  milestones: 0,
  evidence: [],
  startEvidence: [],
  finishEvidence: [],
  accepted: [],
});

const filled = (value: string | null) =>
  value !== null && value.trim().length > 0;

/** Returns the error code, or null when the transition is allowed. */
function check(model: Model, input: TransitionInput): string | null {
  if (input.expectedState !== model.status) return "state_conflict";
  if (GRAPH[model.status].length === 0) return "closed";
  if (!GRAPH[model.status].includes(input.newState)) return "not_allowed";
  const unique = new Set(input.evidenceIds);
  for (const id of unique) {
    if (!model.evidence.includes(id)) return "unknown_evidence";
  }
  switch (input.newState) {
    case "planeado":
      if (!filled(model.responsible)) return "needs_responsible";
      if (model.milestones < 1) return "needs_milestone";
      if (!filled(input.note)) return "needs_note";
      return null;
    case "en_ejecucion":
      if (!filled(input.note)) return "needs_note";
      if (unique.size < 1) return "needs_evidence";
      return null;
    case "ejecutado": {
      if (!filled(input.observation)) return "needs_observation";
      if (!filled(input.difference)) return "needs_difference";
      const fresh = [...unique].filter((id) => !model.startEvidence.includes(id));
      if (fresh.length < 1) return "needs_new_evidence";
      return null;
    }
    case "descartado":
      if (!filled(input.note)) return "needs_reason";
      return null;
    default:
      return "not_allowed";
  }
}

type Command =
  | { kind: "addEvidence" }
  | { kind: "addMilestone" }
  | { kind: "setResponsible"; name: string | null }
  | {
      kind: "transition";
      follow: boolean;
      target: Status;
      staleExpected: Status | null;
      note: string | null;
      observation: string | null;
      difference: string | null;
      picks: number[];
      ghost: boolean;
    };

type Outcome = {
  error: string | null;
  input?: TransitionInput;
  before?: Status;
};

function apply(model: Model, command: Command): Outcome {
  switch (command.kind) {
    case "addEvidence":
      model.evidence.push(`e${model.evidence.length + 1}`);
      return { error: null };
    case "addMilestone":
      model.milestones += 1;
      return { error: null };
    case "setResponsible":
      model.responsible = command.name;
      return { error: null };
    case "transition": {
      const before = model.status;
      const newState = command.follow
        ? (FORWARD[model.status] ?? command.target)
        : command.target;
      const evidenceIds = command.picks.length
        ? [
            ...new Set(
              command.picks.flatMap((pick) =>
                model.evidence.length
                  ? [model.evidence[pick % model.evidence.length]]
                  : [],
              ),
            ),
          ]
        : [];
      if (command.ghost) evidenceIds.push("ghost");
      const input: TransitionInput = {
        expectedState: command.staleExpected ?? model.status,
        newState,
        note: command.note,
        observation: command.observation,
        difference: command.difference,
        evidenceIds,
      };
      const error = check(model, input);
      if (error === null) {
        model.status = newState;
        model.accepted.push({ from: before, to: newState });
        if (newState === "en_ejecucion") model.startEvidence = evidenceIds;
        if (newState === "ejecutado") model.finishEvidence = evidenceIds;
      }
      return { error, input, before };
    }
  }
}

const textArb = fc.oneof(
  { weight: 4, arbitrary: fc.constant("ok") },
  { weight: 1, arbitrary: fc.constantFrom(null, "", "   ") },
);
const transitionArb = fc.record({
  kind: fc.constant("transition" as const),
  follow: fc.boolean(),
  target: fc.constantFrom(...ALL),
  staleExpected: fc.oneof(
    { weight: 9, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constantFrom(...ALL) },
  ),
  note: textArb,
  observation: textArb,
  difference: textArb,
  picks: fc.array(fc.nat(10), { maxLength: 4 }),
  ghost: fc.oneof(
    { weight: 19, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
});
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: "addEvidence" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "addMilestone" as const }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom<string | null>(null, "", "Ana")
      .map((name) => ({ kind: "setResponsible" as const, name })),
  },
  { weight: 8, arbitrary: transitionArb },
);
const good = (picks: number[]): Command => ({
  kind: "transition",
  follow: true,
  target: "descartado",
  staleExpected: null,
  note: "ok",
  observation: "ok",
  difference: "ok",
  picks,
  ghost: false,
});
/** A mostly valid path to ejecutado, wrapped in random commands, so the model is exercised deeply. */
const guidedArb: fc.Arbitrary<Command[]> = fc
  .tuple(
    fc.array(commandArb, { maxLength: 4 }),
    fc.array(fc.nat(3), { minLength: 1, maxLength: 2 }),
    fc.array(fc.nat(3), { minLength: 1, maxLength: 2 }),
    fc.array(commandArb, { maxLength: 6 }),
  )
  .map(([head, startPicks, finishPicks, tail]) => [
    ...head,
    { kind: "setResponsible", name: "Ana" },
    { kind: "addMilestone" },
    { kind: "addEvidence" },
    { kind: "addEvidence" },
    good([]),
    good(startPicks),
    good(finishPicks),
    ...tail,
  ]);
const sequenceArb = fc.oneof(
  fc.array(commandArb, { minLength: 1, maxLength: 40 }),
  guidedArb,
);

describe("reference model: examples", () => {
  const ready = () => {
    const model = initial();
    apply(model, { kind: "setResponsible", name: "Ana" });
    apply(model, { kind: "addMilestone" });
    apply(model, { kind: "addEvidence" });
    apply(model, { kind: "addEvidence" });
    return model;
  };
  const move = (
    model: Model,
    newState: Status,
    extra: Partial<TransitionInput> = {},
  ) =>
    check(model, {
      expectedState: model.status,
      newState,
      note: "ok",
      observation: null,
      difference: null,
      evidenceIds: [],
      ...extra,
    });

  it("walks the happy path", () => {
    const model = ready();
    const step = (
      newState: Status,
      extra: Partial<TransitionInput> = {},
    ) => {
      const input: TransitionInput = {
        expectedState: model.status,
        newState,
        note: "ok",
        observation: null,
        difference: null,
        evidenceIds: [],
        ...extra,
      };
      expect(check(model, input)).toBeNull();
      model.status = newState;
      if (newState === "en_ejecucion") model.startEvidence = input.evidenceIds;
    };
    step("planeado");
    step("en_ejecucion", { evidenceIds: ["e1"] });
    step("ejecutado", {
      observation: "obra",
      difference: "ninguna",
      evidenceIds: ["e2"],
    });
    expect(model.status).toBe("ejecutado");
  });

  it("requires responsible, milestone and note for planeado", () => {
    const model = initial();
    expect(move(model, "planeado")).toBe("needs_responsible");
    model.responsible = "Ana";
    expect(move(model, "planeado")).toBe("needs_milestone");
    model.milestones = 1;
    expect(move(model, "planeado", { note: " " })).toBe("needs_note");
    expect(move(model, "planeado")).toBeNull();
  });

  it("requires a note and evidence for en_ejecucion", () => {
    const model = ready();
    model.status = "planeado";
    expect(move(model, "en_ejecucion")).toBe("needs_evidence");
    expect(move(model, "en_ejecucion", { evidenceIds: ["e1"], note: null })).toBe(
      "needs_note",
    );
    expect(move(model, "en_ejecucion", { evidenceIds: ["nope"] })).toBe(
      "unknown_evidence",
    );
    expect(move(model, "en_ejecucion", { evidenceIds: ["e1"] })).toBeNull();
  });

  it("requires new evidence, observation and difference for ejecutado", () => {
    const model = ready();
    model.status = "en_ejecucion";
    model.startEvidence = ["e1"];
    const full = { observation: "o", difference: "d" };
    expect(move(model, "ejecutado", { ...full, evidenceIds: ["e1"] })).toBe(
      "needs_new_evidence",
    );
    expect(move(model, "ejecutado", { ...full, evidenceIds: [] })).toBe(
      "needs_new_evidence",
    );
    expect(
      move(model, "ejecutado", { observation: "o", difference: null, evidenceIds: ["e2"] }),
    ).toBe("needs_difference");
    expect(
      move(model, "ejecutado", { observation: null, difference: "d", evidenceIds: ["e2"] }),
    ).toBe("needs_observation");
    expect(move(model, "ejecutado", { ...full, evidenceIds: ["e1", "e2"] })).toBeNull();
  });

  it("requires a reason for descartado and allows it from the first three states", () => {
    for (const status of ["en_revision", "planeado", "en_ejecucion"] as const) {
      const model = initial();
      model.status = status;
      expect(move(model, "descartado", { note: null })).toBe("needs_reason");
      expect(move(model, "descartado")).toBeNull();
    }
  });

  it("rejects skipping states and any move out of a closed state", () => {
    const model = ready();
    expect(move(model, "ejecutado")).toBe("not_allowed");
    expect(move(model, "en_ejecucion")).toBe("not_allowed");
    for (const closed of ["ejecutado", "descartado"] as const) {
      model.status = closed;
      for (const target of ALL) {
        expect(move(model, target)).toBe("closed");
      }
    }
  });

  it("rejects a stale expected state", () => {
    const model = initial();
    expect(
      check(model, {
        expectedState: "planeado",
        newState: "descartado",
        note: "ok",
        observation: null,
        difference: null,
        evidenceIds: [],
      }),
    ).toBe("state_conflict");
  });
});

describe("reference model: random command sequences (seed 20260514)", () => {
  it("ejecutado is never reached without evidence not cited at execution start", () => {
    let reached = 0;
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const model = initial();
        for (const command of commands) {
          const wasExecuted = model.status === "ejecutado";
          const outcome = apply(model, command);
          if (
            command.kind === "transition" &&
            outcome.error === null &&
            outcome.input?.newState === "ejecutado"
          ) {
            expect(wasExecuted).toBe(false);
            reached += 1;
            const fresh = model.finishEvidence.filter(
              (id) =>
                model.evidence.includes(id) &&
                !model.startEvidence.includes(id),
            );
            expect(fresh.length).toBeGreaterThanOrEqual(1);
            expect(model.startEvidence.length).toBeGreaterThanOrEqual(1);
          }
        }
        if (model.status === "ejecutado") {
          expect(model.finishEvidence.some((id) => !model.startEvidence.includes(id))).toBe(true);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
    // Guard against a vacuous property: the generator must reach ejecutado.
    expect(reached).toBeGreaterThan(0);
  });

  it("status always follows the allowed graph and starts at en_revision", () => {
    let transitions = 0;
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const model = initial();
        let current: Status = model.status;
        for (const command of commands) {
          const outcome = apply(model, command);
          if (outcome.error !== null) {
            expect(model.status).toBe(current);
          } else if (model.status !== current) {
            expect(GRAPH[current]).toContain(model.status);
            current = model.status;
          }
        }
        for (const { from, to } of model.accepted) {
          expect(GRAPH[from]).toContain(to);
        }
        // Accepted transitions chain without gaps from en_revision.
        let cursor: Status = "en_revision";
        for (const { from, to } of model.accepted) {
          expect(from).toBe(cursor);
          cursor = to;
        }
        expect(cursor).toBe(model.status);
        transitions += model.accepted.length;
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(transitions).toBeGreaterThan(0);
  });

  it("closed states reject every further transition and keep their state", () => {
    let closedChecks = 0;
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const model = initial();
        let closedAt: Status | null = null;
        for (const command of commands) {
          const outcome = apply(model, command);
          if (closedAt !== null && command.kind === "transition") {
            expect(outcome.error).not.toBeNull();
            expect(model.status).toBe(closedAt);
            closedChecks += 1;
          }
          if (closedAt === null && GRAPH[model.status].length === 0) {
            closedAt = model.status;
          }
        }
        if (closedAt !== null) expect(model.status).toBe(closedAt);
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(closedChecks).toBeGreaterThan(0);
  });

  it("a rejected command never changes the state or the recorded transitions", () => {
    fc.assert(
      fc.property(sequenceArb, (commands) => {
        const model = initial();
        for (const command of commands) {
          const snapshot = structuredClone(model);
          const outcome = apply(model, command);
          if (command.kind === "transition" && outcome.error !== null) {
            expect(model).toEqual(snapshot);
          }
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
