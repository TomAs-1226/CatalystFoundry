import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ClipboardList,
  FolderOpen,
  Plus,
  Save,
  Search,
} from "lucide-react";
import type { JobStatus, Project } from "../domain/model";
import { formatDate } from "./ui";

export interface ManufacturingQueueProps {
  project: Project;
  onOpenJob: (id: string) => void;
  onCreateJob: () => void;
  onExportProject: () => void;
  onImportProject: () => void;
  onSaveProject: () => void;
  busy?: boolean;
}

const statuses: JobStatus[] = [
  "draft",
  "needs review",
  "ready to slice",
  "sliced",
  "approved",
  "assigned",
  "printing",
  "completed",
];

/** The queue reports recorded workflow state. It does not infer machine activity. */
export default function ManufacturingQueue({
  project,
  onOpenJob,
  onCreateJob,
  onExportProject,
  onImportProject,
  onSaveProject,
  busy = false,
}: ManufacturingQueueProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const jobs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return project.jobs.filter((job) => {
      const partNames = job.items.map(
        (item) =>
          project.parts.find((part) => part.id === item.partId)?.name ??
          "Missing part",
      );
      const text = [
        job.name,
        job.id,
        job.assignee,
        job.material.name,
        job.printer.model,
        ...partNames,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (status === "all" || job.status === status) &&
        (!normalized || text.includes(normalized))
      );
    });
  }, [project.jobs, project.parts, query, status]);

  return (
    <section className="queue-page" aria-labelledby="queue-title">
      <header className="queue-heading">
        <div>
          <span className="queue-eyebrow">Manufacturing</span>
          <h2 id="queue-title">Manufacturing queue</h2>
          <p className="queue-description">
            Prepare and review exact jobs, then export a package for an
            operator.
          </p>
        </div>
        <button
          className="primary queue-create"
          onClick={onCreateJob}
          disabled={busy}
        >
          <Plus size={16} />
          New job
        </button>
      </header>

      <div className="queue-toolbar">
        <label className="queue-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search jobs"
            placeholder="Search jobs, parts or operators"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="queue-status-filter">
          <span>Status</span>
          <select
            aria-label="Queue status filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <span className="queue-result-count" role="status">
          {jobs.length} of {project.jobs.length} jobs
        </span>
      </div>

      {jobs.length > 0 ? (
        <div
          className="queue-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Manufacturing jobs table"
        >
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Parts / copies</th>
                <th scope="col">Material</th>
                <th scope="col">Printer / nozzle</th>
                <th scope="col">Status</th>
                <th scope="col">Operator</th>
                <th scope="col">Exports</th>
                <th scope="col">
                  <span className="queue-column-action">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const partTypes = new Set(job.items.map((item) => item.partId))
                  .size;
                const copies = job.items.reduce(
                  (total, item) => total + item.quantity + item.spareQuantity,
                  0,
                );
                const spares = job.items.reduce(
                  (total, item) => total + item.spareQuantity,
                  0,
                );
                const missingParts = job.items.some(
                  (item) =>
                    !project.parts.some((part) => part.id === item.partId),
                );
                const demonstration =
                  job.approval?.demonstrationOnly ||
                  job.toolpath?.source === "fixture" ||
                  job.items.some(
                    (item) =>
                      project.parts.find((part) => part.id === item.partId)
                        ?.source.kind === "fixture",
                  );
                const mappingRevoked =
                  job.toolpath && !job.toolpath.mappingConfirmed;
                const lastRelease = job.releases.at(-1);
                return (
                  <tr
                    key={job.id}
                    className={
                      job.id === project.activeJobId
                        ? "queue-current"
                        : undefined
                    }
                  >
                    <th scope="row" className="queue-job-name">
                      <span>{job.name}</span>
                      <small>Updated {formatDate(job.updatedAt)}</small>
                      {demonstration && (
                        <small className="queue-demo-label">
                          Demonstration · no manufacturing release
                        </small>
                      )}
                    </th>
                    <td>
                      <span className="queue-number">
                        {partTypes} {partTypes === 1 ? "type" : "types"} /{" "}
                        {copies} {copies === 1 ? "copy" : "copies"}
                      </span>
                      <small>
                        {spares > 0
                          ? `${spares} ${spares === 1 ? "spare" : "spares"} included`
                          : "No spares"}
                      </small>
                      {missingParts && (
                        <small className="queue-warning">
                          Missing source part · review required
                        </small>
                      )}
                    </td>
                    <td>
                      <span>{job.material.name}</span>
                      <small>
                        {job.material.tested
                          ? "Team tested profile"
                          : "Untested material profile"}
                      </small>
                    </td>
                    <td>
                      <span>{job.printer.model}</span>
                      <small>
                        {job.printer.nozzleDiameter} mm nozzle ·{" "}
                        {job.printer.plate}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`queue-status queue-status-${job.status.replaceAll(" ", "-")}`}
                      >
                        {job.status}
                      </span>
                      {job.toolpath?.stale && (
                        <small className="queue-warning">
                          Stale toolpath · re-review required
                        </small>
                      )}
                      {mappingRevoked && (
                        <small className="queue-warning">
                          Toolpath mapping revoked
                        </small>
                      )}
                    </td>
                    <td>
                      {job.assignee ? (
                        <span>{job.assignee}</span>
                      ) : (
                        <span className="queue-muted">Unassigned</span>
                      )}
                      {(job.status === "printing" ||
                        job.status === "completed") && (
                        <small>Operator recorded</small>
                      )}
                    </td>
                    <td>
                      <span className="queue-number">
                        {job.releases.length}{" "}
                        {job.releases.length === 1 ? "record" : "records"}
                      </span>
                      {lastRelease && (
                        <small>
                          {formatDate(lastRelease.at)} · {lastRelease.actor}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="queue-open"
                        onClick={() => onOpenJob(job.id)}
                        disabled={busy}
                      >
                        Open job
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="queue-empty">
          <ClipboardList size={27} aria-hidden="true" />
          <h3>
            {project.jobs.length
              ? "No matching jobs"
              : "Your manufacturing queue is empty"}
          </h3>
          <p>
            {project.jobs.length
              ? "Change the search or status filter to find a job."
              : "Create a job, then add make parts from CAD or a local import."}
          </p>
          {project.jobs.length ? (
            <button
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          ) : (
            <button onClick={onCreateJob} disabled={busy}>
              <Plus size={15} />
              Create first job
            </button>
          )}
        </div>
      )}

      <p className="queue-machine-note">
        Assignment records operator responsibility. It does not mean a printer
        has accepted or started a job. Direct machine handoff is unavailable;
        approved packages use operator-controlled export.
      </p>

      <footer className="queue-portability" aria-label="Project files">
        <div>
          <strong>Workspace project</strong>
          <span>Keep source geometry, jobs and review history together.</span>
        </div>
        <div className="queue-project-actions">
          <button onClick={onSaveProject} disabled={busy}>
            <Save size={15} />
            Save workspace project
          </button>
          <button onClick={onExportProject} disabled={busy}>
            <ArrowDownToLine size={15} />
            Export project
          </button>
          <button onClick={onImportProject} disabled={busy}>
            <FolderOpen size={15} />
            Import project
          </button>
        </div>
      </footer>
    </section>
  );
}
