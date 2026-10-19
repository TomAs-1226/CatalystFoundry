import { useMemo } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Info,
  Rotate3D,
  AlertTriangle,
} from "lucide-react";
import type { Job, Project, Vec3 } from "../domain/model";
import {
  orientationSuggestions,
  proposePlacement,
  type PreflightIssue,
  type QuantityReconciliation,
} from "../domain/preparation";

export function PreparationAssistant({
  project,
  job,
  partId,
  onOrientation,
  onPlacement,
  onReviewContext,
}: {
  project: Project;
  job: Job;
  partId: string;
  onOrientation: (orientation: Vec3) => void;
  onPlacement: (orientation: Vec3, position: Vec3) => void;
  onReviewContext: () => void;
}) {
  const candidates = useMemo(
    () => orientationSuggestions(project, job, partId),
    [project, job, partId],
  );
  const proposal = useMemo(
    () => proposePlacement(project, job, partId),
    [project, job, partId],
  );
  if (!candidates.length) return null;
  return (
    <section className="inspector-section preparation-assistant">
      <div className="section-title">
        <h3>Preparation suggestions</h3>
        <span className="quiet-label">GEOMETRY ONLY</span>
      </div>
      <p className="smalltext">
        Compare conservative bounds and height. Loads, supports and strength
        have not been calculated.
      </p>
      <details className="engineering-details">
        <summary>
          Orientation alternatives <ChevronRight size={12} />
        </summary>
        <div className="candidate-list">
          {candidates.map((c) => (
            <div className="candidate" key={c.id}>
              <div className="candidate-heading">
                <strong>{c.title}</strong>
                <span className={c.fits ? "fit-label" : "outside-label"}>
                  {c.fits ? "Fits empty plate" : "Does not fit"}
                </span>
              </div>
              <p>
                {c.dimensions.map((n) => Number(n.toFixed(2))).join(" × ")} mm ·{" "}
                {c.orientation.join(" / ")}°
              </p>
              <details>
                <summary>Why / assumptions</summary>
                <ul>
                  {[...c.explanations, ...c.assumptions, ...c.tradeoffs].map(
                    (text, i) => (
                      <li key={i}>{text}</li>
                    ),
                  )}
                </ul>
              </details>
              <button
                className="btn small"
                aria-label={`Apply orientation ${c.title}`}
                onClick={() => onOrientation(c.orientation)}
              >
                <Rotate3D size={12} />
                Apply orientation
              </button>
            </div>
          ))}
        </div>
      </details>
      <details className="engineering-details">
        <summary>
          Build-volume suggestion <ChevronRight size={12} />
        </summary>
        <p className="smalltext">{proposal.reason}</p>
        {proposal.available && (
          <>
            <div className="proposal-coordinates">
              <span>Position</span>
              <b>
                {proposal
                  .position!.map((n) => Number(n.toFixed(2)))
                  .join(" / ")}{" "}
                mm
              </b>
              <span>Rotation</span>
              <b>{proposal.orientation!.join(" / ")}°</b>
              <span>Copies</span>
              <b>{proposal.totalCopies} including spares</b>
            </div>
            <button
              className="btn small fullwidth"
              aria-label="Apply placement suggestion"
              onClick={() =>
                onPlacement(proposal.orientation!, proposal.position!)
              }
            >
              Apply placement suggestion
              <ArrowRight size={12} />
            </button>
          </>
        )}
        <details className="assumptions">
          <summary>Assumptions & limitations</summary>
          <ul>
            {[...proposal.explanations, ...proposal.assumptions].map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      </details>
      <button className="context-review-link" onClick={onReviewContext}>
        <Info size={12} />
        {job.useCase.confirmed
          ? "Review supplied load context"
          : "Loads & critical surfaces need team review"}
        <ArrowRight size={12} />
      </button>
    </section>
  );
}
export function PreflightPanel({
  issues,
  rows,
  onJump,
  onReconcile,
}: {
  issues: PreflightIssue[];
  rows: QuantityReconciliation[];
  onJump: (issue: PreflightIssue) => void;
  onReconcile: (partId: string, quantity: number) => void;
}) {
  const errors = issues.filter((i) => i.severity === "error"),
    warnings = issues.filter((i) => i.severity === "warning");
  return (
    <>
      <section className="inspector-section">
        <div className="section-title">
          <h3>Job preflight</h3>
          <span className={errors.length ? "issue-count error" : "issue-count"}>
            {errors.length} {errors.length === 1 ? "error" : "errors"} ·{" "}
            {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
          </span>
        </div>
        <p className="smalltext">
          Each issue opens its affected setting. Warnings disclose assumptions;
          manual choices are retained.
        </p>
        <div className="preflight-list" aria-label="Preflight issues">
          {issues.map((issue) => (
            <button
              key={issue.id}
              className={`preflight-issue ${issue.severity}`}
              aria-label={`Fix: ${issue.message}`}
              onClick={() => onJump(issue)}
            >
              <span className="issue-mark">
                {issue.severity === "error" ? (
                  <AlertTriangle size={13} />
                ) : (
                  <Info size={13} />
                )}
              </span>
              <span>
                <strong>{issue.message}</strong>
                <small>{issue.detail}</small>
                <em>
                  Open {issue.field}
                  <ArrowRight size={11} />
                </em>
              </span>
            </button>
          ))}
          {!issues.length && (
            <p className="smalltext">
              <Check size={12} /> No preflight issues for the current inputs.
              Physical conditions still require operator checks.
            </p>
          )}
        </div>
      </section>
      <section className="inspector-section">
        <div className="section-title">
          <h3>Quantity reconciliation</h3>
          <span className="quiet-label">CAD → BATCH</span>
        </div>
        <p className="smalltext">
          Required parts and additional spares remain separate. A partial batch
          is a permitted manual override.
        </p>
        {rows.map((row) => (
          <div className="quantity-reconciliation" key={row.partId}>
            <strong>{row.name}</strong>
            <div className="quantity-grid">
              <span>CAD</span>
              <span>Required</span>
              <span>Spares</span>
              <span>Total</span>
              <b>{row.cadQuantity}</b>
              <b>{row.plannedQuantity}</b>
              <b>{row.spareQuantity}</b>
              <b>{row.totalQuantity}</b>
            </div>
            <small>
              {row.sourceBasis}
              {row.occurrenceCount
                ? ` · ${row.occurrenceCount} unique installed occurrences`
                : ""}
            </small>
            {row.needsReview && (
              <div className="quantity-override">
                <span>
                  {row.delta > 0
                    ? `${row.delta} above CAD demand`
                    : `${Math.abs(row.delta)} below CAD demand`}{" "}
                  · manual override
                </span>
                <button
                  className="linkbutton"
                  aria-label={`Use CAD quantity for ${row.name}`}
                  disabled={
                    row.suggestedQuantity < 1 ||
                    row.suggestedQuantity + row.spareQuantity > 1000
                  }
                  onClick={() => onReconcile(row.partId, row.suggestedQuantity)}
                >
                  Use CAD quantity
                  <ArrowRight size={11} />
                </button>
              </div>
            )}
          </div>
        ))}
        {!rows.length && (
          <p className="smalltext" style={{ marginTop: 12 }}>
            Include a part to reconcile its quantities.
          </p>
        )}
      </section>
    </>
  );
}
