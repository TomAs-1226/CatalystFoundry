import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Link,
  Unplug,
  Box,
  LoaderCircle,
  AlertTriangle,
} from "lucide-react";
import { Modal, Field } from "./ui";
import {
  fixtureCatalog,
  fixtureDefaultSelection,
  fixtureUrl,
  getFixturePartOptions,
  importFixtureParts,
  parseOnshapeUrl,
  createLocalPart,
} from "../adapters/onshape";
import type { Part } from "../domain/model";
import LiveOnshapeIntake,{type RobotImportOptions} from "./GuidedOnshapeIntake";
import "./source-intake.css";
import SharedCadIntake from "./SharedCadIntake";
export type SourceTab = "shared" | "onshape" | "fixtures" | "local";
interface Props {
  onClose: () => void;
  onImport: (parts: Part[],options?:RobotImportOptions) => void | boolean;
  onError: (message: string) => void;
  initialTab?: SourceTab;
  initialOnshapeUrl?:string;
  initialWorkOrder?:string;
}
export default function SourceDialog({
  onClose,
  onImport,
  initialTab = "shared",
  initialOnshapeUrl='',
  initialWorkOrder='',
}: Props) {
  const [selection, setSelection] = useState({ ...fixtureDefaultSelection });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [spares, setSpares] = useState<Record<string, number>>({});
  const [url, setUrl] = useState("");
  const [urlInfo, setUrlInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, message: "" });
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SourceTab>(initialTab);
  const [units, setUnits] = useState<"mm" | "in">("mm");
  const [localFile, setLocalFile] = useState<File>();
  const [localPart, setLocalPart] = useState<Part>();
  const [dimensionsConfirmed, setDimensionsConfirmed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const localInspection = useRef(0);
  useEffect(
    () => () => {
      abort.current?.abort();
      localInspection.current++;
    },
    [],
  );
  const options = useMemo(() => getFixturePartOptions(selection), [selection]);
  const ids =
    selected ??
    options
      .filter(
        (p) => p.classification === "make" && p.available && !p.suppressed,
      )
      .map((p) => p.id);
  const invalidFixtureSpares = ids.some(
    (id) =>
      !Number.isInteger(spares[id] ?? 0) ||
      (spares[id] ?? 0) < 0 ||
      (spares[id] ?? 0) > 999,
  );
  const document =
    fixtureCatalog.find((d) => d.id === selection.documentId) ??
    fixtureCatalog[0];
  function changeSelection(p: Partial<typeof selection>) {
    setSelection({ ...selection, ...p });
    setSelected(null);
    setError("");
  }
  async function importParts() {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const parts = await importFixtureParts(
        { ...selection, partIds: ids, spares, excludePurchased: true },
        { signal: abort.current.signal, onProgress: (p) => setProgress(p) },
      );
      onImport(parts);
      onClose();
    } catch (e) {
      setError(
        abort.current?.signal.aborted
          ? "Geometry transfer cancelled. No parts were imported."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  function pasteLink() {
    try {
      const p = parseOnshapeUrl(url);
      const doc = fixtureCatalog.find((d) => d.id === p.documentId);
      if (doc) {
        const element = doc.elements.find((e) => e.id === p.elementId);
        const version = doc.versions.find((v) => v.id === p.versionId);
        const config = doc.configurations.find((c) => c.id === p.configuration);
        if (
          !element ||
          (p.versionId && !version) ||
          (p.configuration !== "default" && !config)
        )
          throw new Error(
            "This element, version or configuration is not available in the fixture catalog. Live Onshape is unavailable.",
          );
        setSelection({
          ...selection,
          documentId: doc.id,
          elementId: element.id,
          versionId: version?.id ?? selection.versionId,
          configuration: config?.id ?? selection.configuration,
        });
        setSelected(null);
        setUrlInfo(
          p.referenceType === "w"
            ? "Fixture workspace found. Select an immutable version below."
            : p.referenceType === "m"
              ? "Microversion link found. Choose a named immutable version below; this microversion is not imported."
              : "Fixture document found. The selected immutable version is pinned.",
        );
      } else {
        setUrlInfo(
          "Valid Onshape link. Live access is unavailable; configure the server adapter before importing this document.",
        );
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function inspectLocal(file: File | undefined, newUnits = units) {
    const inspection = ++localInspection.current;
    setLocalFile(file);
    setLocalPart(undefined);
    setDimensionsConfirmed(false);
    setError("");
    setBusy(false);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError(
        "STL exceeds the 20 MiB limit. Export a smaller tessellation from CAD.",
      );
      return;
    }
    try {
      setBusy(true);
      const part = await createLocalPart(
        await file.arrayBuffer(),
        newUnits,
        file.name,
      );
      if (inspection === localInspection.current) setLocalPart(part);
    } catch (e) {
      if (inspection === localInspection.current)
        setError((e as Error).message);
    } finally {
      if (inspection === localInspection.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={tab==='onshape'?'Add robot from Onshape':tab==='shared'?'Choose team parts':'Advanced source options'}
      subtitle={tab==='onshape'?'Load the part list, then save the robot for everyone. No project file is needed.':'Choose saved CAD for an unapproved draft job.'}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      footer={
        <>
          <small>
            {tab === "fixtures"
              ? `${ids.length} part types selected · purchased parts excluded`
              : tab === "local"
                ? "Original STL is preserved · no automatic repair"
                : "Credentials stay on the local server."}
          </small>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                abort.current?.abort();
                onClose();
              }}
            >
              Cancel
            </button>
            {tab === "fixtures" ? (
              <button
                className="btn primary"
                disabled={busy || !ids.length || invalidFixtureSpares}
                onClick={importParts}
              >
                {busy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ArrowDownToLine size={14} />
                )}
                Import selected parts
              </button>
            ) : tab === "local" ? (
              <button
                className="btn primary"
                disabled={!localPart || !dimensionsConfirmed || busy}
                onClick={() => {
                  if (localPart) {
                    onImport([localPart]);
                    onClose();
                  }
                }}
              >
                Add inspected STL
              </button>
            ) : null}
          </div>
        </>
      }
    >
      <div
        className="tabs-inline source-intake-tabs"
        role="tablist"
        aria-label="Design source"
      >
        <button role="tab" aria-selected={tab === "shared"} className={tab === "shared" ? "active" : ""} disabled={busy} onClick={()=>{setTab("shared");setError("");}}>Team parts</button>
        <button
          role="tab"
          aria-selected={tab === "onshape"}
          className={tab === "onshape" ? "active" : ""}
          disabled={busy}
          onClick={() => {
            setTab("onshape");
            setError("");
          }}
        >
          Onshape
        </button>
        <button
          role="tab"
          aria-selected={tab === "fixtures"}
          className={tab === "fixtures" ? "active" : ""}
          disabled={busy}
          onClick={() => {
            setTab("fixtures");
            setError("");
          }}
        >
          Demonstration fixtures
        </button>
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={tab === "local" ? "active" : ""}
          disabled={busy}
          onClick={() => {
            setTab("local");
            setError("");
          }}
        >
          Local STL fallback
        </button>
      </div>
      {tab === "shared" ? <SharedCadIntake workOrder={initialWorkOrder} onImport={(parts,options)=>{const accepted=onImport(parts,options);if(accepted!==false)onClose();return accepted;}}/> : tab === "onshape" ? (
        <LiveOnshapeIntake
          initialUrl={initialOnshapeUrl}
          initialWorkOrder={initialWorkOrder}
          onLibrary={()=>setTab('shared')}
          onImport={(parts,options) => {
            if(onImport(parts,options)!==false)onClose();
          }}
        />
      ) : tab === "fixtures" ? (
        <>
          <div className="notice info">
            <Unplug
              size={13}
              style={{ verticalAlign: "middle", marginRight: 6 }}
            />
            <b>Demonstration fixtures — not production CAD.</b> These local,
            versioned samples demonstrate selection and transfer. They do not
            connect to your Onshape account or establish a manufacturable job.
          </div>
          <Field
            label="Open an Onshape link"
            hint="Document, assembly and Part Studio links are accepted. Workspace links require an immutable version selection."
          >
            <div className="row">
              <input
                placeholder="https://cad.onshape.com/documents/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Onshape document link"
              />
              <button className="btn" onClick={pasteLink}>
                <Link size={13} />
                Resolve
              </button>
            </div>
          </Field>
          {urlInfo && <p className="smalltext">{urlInfo}</p>}
          <div className="source-grid">
            {fixtureCatalog.map((d) => (
              <button
                key={d.id}
                className={`source-option ${d.id === document.id ? "active" : ""}`}
                onClick={() => {
                  setSelection({
                    ...selection,
                    documentId: d.id,
                    versionId: d.versions[0].id,
                    elementId: d.elements[0].id,
                    configuration: d.configurations[0].id,
                  });
                  setSelected(null);
                }}
              >
                <div
                  className="row"
                  style={{ justifyContent: "space-between" }}
                >
                  <Box size={19} />
                  <span className="badge-label">FIXTURE</span>
                </div>
                <strong>{d.name}</strong>
                <p>
                  Versioned robot components · configuration-aware
                  <br />
                  Repeated assembly instances retain their quantities.
                </p>
              </button>
            ))}
            <div className="source-option" style={{ opacity: 0.65 }}>
              <Unplug size={19} />
              <strong>Your Onshape workspace</strong>
              <p>
                Unavailable until authorised access is configured.
                <br />
                Setup steps are included in docs/ONSHAPE.md.
              </p>
            </div>
          </div>
          <div className="fieldrow">
            <Field label="Source element">
              <select
                aria-label="Source element"
                value={selection.elementId}
                onChange={(e) => changeSelection({ elementId: e.target.value })}
              >
                {document.elements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ·{" "}
                    {e.type === "assembly" ? "Assembly" : "Part Studio"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Immutable version">
              <select
                aria-label="Immutable version"
                value={selection.versionId}
                onChange={(e) => changeSelection({ versionId: e.target.value })}
              >
                {document.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Configuration">
            <select
              aria-label="Configuration"
              value={selection.configuration}
              onChange={(e) =>
                changeSelection({ configuration: e.target.value })
              }
            >
              {document.configurations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <table className="source-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Part</th>
                <th>CAD qty</th>
                <th>Spares</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {options.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name}`}
                      checked={ids.includes(p.id)}
                      disabled={
                        !p.available ||
                        p.suppressed ||
                        p.classification === "buy"
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    {p.name}
                    <small>
                      {p.dimensions.join(" × ")} mm
                      {p.linkedDocumentId ? " · linked document" : ""}
                      {!p.available ? " · unavailable" : ""}
                      {p.suppressed ? " · suppressed" : ""}
                    </small>
                  </td>
                  <td>{p.quantity}</td>
                  <td>
                    <input
                      type="number"
                      aria-label={`Spares for ${p.name}`}
                      min={0}
                      max={999}
                      style={{ width: 61, padding: 5, fontSize: 11 }}
                      value={spares[p.id] ?? 0}
                      disabled={!ids.includes(p.id)}
                      onChange={(e) =>
                        setSpares({ ...spares, [p.id]: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <span
                      className={`tag ${p.classification === "make" ? "green" : ""}`}
                    >
                      {p.classification}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invalidFixtureSpares && (
            <div className="notice error" role="alert">
              Spare quantities must be whole numbers from 0 through 999.
            </div>
          )}
          <p className="smalltext" style={{ marginTop: 13 }}>
            Suppressed, unavailable linked and purchased components are
            excluded. Selecting the same part in several assembly paths adds its
            occurrence quantities.{" "}
            <button className="linkbutton" onClick={() => setUrl(fixtureUrl)}>
              Use fixture link
            </button>
          </p>
        </>
      ) : (
        <>
          <div className="notice">
            STL has no intrinsic units. Choose the source units and verify the
            resulting dimensions. We preserve the original file and never
            silently repair or rescale it.
          </div>
          <Field label="Source units">
            <select
              aria-label="STL source units"
              value={units}
              onChange={(e) => {
                const u = e.target.value as "mm" | "in";
                setUnits(u);
                void inspectLocal(localFile, u);
              }}
            >
              <option value="mm">Millimetres (mm)</option>
              <option value="in">
                Inches (in) → explicit conversion to mm
              </option>
            </select>
          </Field>
          <input
            type="file"
            ref={input}
            accept=".stl"
            style={{ display: "none" }}
            onChange={(e) => void inspectLocal(e.target.files?.[0])}
          />
          <button
            className="btn fullwidth"
            onClick={() => input.current?.click()}
          >
            <ArrowDownToLine size={15} />
            {localFile?.name ?? "Choose an ASCII or binary STL · max 20 MiB"}
          </button>
          {localPart && (
            <div className="card" style={{ marginTop: 17 }}>
              <h3>{localPart.name}</h3>
              <p style={{ marginTop: 10 }}>
                Dimensions:{" "}
                <b>
                  {localPart.geometry.dimensions
                    .map((n) => n.toFixed(2))
                    .join(" × ")}{" "}
                  mm
                </b>
                <br />
                SHA-256: {localPart.geometry.hash.slice(0, 20)}…<br />
                Classification: review required. Confirm make/buy in the parts
                inspector.
              </p>
              {localPart.geometry.warnings?.map((w, i) => (
                <div className="notice error" key={i} style={{ marginTop: 10 }}>
                  Geometry review required: {w}
                </div>
              ))}
              <label className="togglelabel">
                <input
                  type="checkbox"
                  checked={dimensionsConfirmed}
                  onChange={(e) => setDimensionsConfirmed(e.target.checked)}
                />
                I checked these dimensions against the intended CAD dimensions.
              </label>
            </div>
          )}
          <p className="smalltext" style={{ marginTop: 17 }}>
            This version accepts ASCII and binary STL only. STEP, OBJ and
            geometry-only 3MF imports are deferred. A 3MF geometry container is
            not a Bambu slicing profile.
          </p>
        </>
      )}
      {busy && (
        <div className="loading">
          <LoaderCircle size={16} className="spin" />
          <div style={{ width: "100%" }}>
            {progress.message || "Inspecting geometry…"}
            <div className="progressbar">
              <div style={{ width: `${progress.percent}%` }} />
            </div>
            <button
              className="linkbutton"
              onClick={() => abort.current?.abort()}
            >
              Cancel transfer
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert" style={{ marginTop: 15 }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}
    </Modal>
  );
}
