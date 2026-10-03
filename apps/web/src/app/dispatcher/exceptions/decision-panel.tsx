"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DetailPanel, PanelSection } from "@/components/ui/detail-panel";
import { Consequences, Modal } from "@/components/ui/modal";
import { Advisory, ErrorPanel } from "@/components/ui/states";
import { decideException, type DecisionState } from "./actions";
import { confirmLabel, consequenceItems, defaultOption, type DecisionOption } from "./model";

const IDLE: DecisionState = { status: "idle" };

/**
 * The right-hand panel, with the decision control in the middle of it.
 *
 * The panel's static sections (title, quantities, outlets, activity) are
 * rendered on the server and arrive as `before` / `after`; only the radio
 * choice, the dialog and its form need the browser. The dialog's list of what
 * will happen is the chosen option's own `consequences` from the API, so the
 * preview and the action cannot drift apart.
 *
 * The dialog stays mounted after a decision. Applying one revalidates the
 * page, the exception comes back resolved with no options, and unmounting
 * then would swallow the confirmation of what was done.
 */
export function DecisionPanel({
  exceptionId,
  options,
  eyebrow,
  contextLine,
  before,
  after,
  noDecision,
  noDecisionFooter,
}: {
  exceptionId: string;
  options: DecisionOption[];
  /** "Critical · Loading", above the dialog title. */
  eyebrow: string;
  /** The exception's title and subtitle, under the dialog title. */
  contextLine: string;
  before: ReactNode;
  after: ReactNode;
  /** Shown in place of the choices when nothing can be decided, and why. */
  noDecision: ReactNode;
  noDecisionFooter?: ReactNode;
}) {
  const groupId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ attempt: number; option: DecisionOption; eyebrow: string; contextLine: string } | null>(null);
  const [open, setOpen] = useState(false);

  // The recommended option unless the dispatcher picked another that is still on offer.
  const selected = options.find((option) => option.decision === chosen) ?? defaultOption(options);

  return (
    <>
      <DetailPanel
        footer={
          selected ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                setDialog((current) => ({ attempt: (current?.attempt ?? 0) + 1, option: selected, eyebrow, contextLine }));
                setOpen(true);
              }}
            >
              <span aria-hidden>✓</span> Apply decision
            </Button>
          ) : (
            noDecisionFooter
          )
        }
      >
        {before}
        {options.length > 0 ? (
          <PanelSection title="Choose a decision">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Choose a decision</legend>
              {options.map((option) => {
                const checked = option.decision === selected?.decision;
                return (
                  <label
                    key={option.decision}
                    className={`flex cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-link ${
                      checked ? "border-action bg-warn-surface" : "border-line bg-surface hover:bg-raised"
                    }`}
                  >
                    <input
                      type="radio"
                      name={groupId}
                      value={option.decision}
                      checked={checked}
                      onChange={() => setChosen(option.decision)}
                      className="mt-1 size-4 accent-action"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-semibold text-ink">{option.label}</span>
                        {option.recommended ? (
                          <span className="shrink-0 rounded-control bg-good-surface px-1.5 py-0.5 text-xs font-semibold text-good-ink">
                            Recommended
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </PanelSection>
        ) : (
          noDecision
        )}
        {after}
      </DetailPanel>

      {dialog ? (
        <ApplyDialog
          // A new attempt is a new form: the result of the last one must not greet the next.
          key={dialog.attempt}
          open={open}
          onClose={() => setOpen(false)}
          exceptionId={exceptionId}
          option={dialog.option}
          // Snapshots: once the decision lands the exception comes back resolved,
          // and its severity (and so the pill text) changes under the open dialog.
          eyebrow={dialog.eyebrow}
          contextLine={dialog.contextLine}
        />
      ) : null}
    </>
  );
}

function ApplyDialog({
  open,
  onClose,
  exceptionId,
  option,
  eyebrow,
  contextLine,
}: {
  open: boolean;
  onClose: () => void;
  exceptionId: string;
  option: DecisionOption;
  eyebrow: string;
  contextLine: string;
}) {
  const [state, formAction, pending] = useActionState(decideException, IDLE);
  const formId = useId();
  const noteId = useId();
  const done = state.status === "done";

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={eyebrow}
      title={done ? "Decision recorded" : "Apply this decision?"}
      context={contextLine}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Applying…" : confirmLabel(option)}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-4">
          {state.replayed ? (
            <Advisory>This decision had already been applied, so nothing was done this time.</Advisory>
          ) : null}
          <div className="rounded-card border border-action bg-warn-surface p-3">
            <p className="font-semibold text-ink">{option.label}</p>
          </div>
          {state.consequences.length > 0 ? (
            <Consequences title="What was done" items={state.consequences} />
          ) : null}
        </div>
      ) : (
        <form id={formId} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="exceptionId" value={exceptionId} />
          <input type="hidden" name="decision" value={option.decision} />

          {state.status === "failed" ? (
            <ErrorPanel title={state.title} detail={state.detail} outcome={state.outcome} />
          ) : null}

          <div className="rounded-card border border-action bg-warn-surface p-3">
            <p className="font-semibold text-ink">{option.label}</p>
            <p className="mt-0.5 text-sm text-muted">{option.description}</p>
          </div>

          <Consequences items={consequenceItems(option.consequences)} />

          <div>
            <label htmlFor={noteId} className="text-sm font-semibold text-ink">
              Note{" "}
              <span className="font-normal text-muted">{option.requiresNote ? "(required, kept as the resolution)" : "(optional)"}</span>
            </label>
            <textarea
              id={noteId}
              name="note"
              rows={2}
              maxLength={500}
              required={option.requiresNote}
              className="mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm text-ink"
            />
          </div>

          {option.followUp ? (
            <label className="flex items-start gap-3 rounded-card border border-line bg-raised p-3 text-sm text-ink">
              <input type="checkbox" name="followUp" className="mt-0.5 size-4 accent-action" />
              <span>{option.followUp.label}</span>
            </label>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
