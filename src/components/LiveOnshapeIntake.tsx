import {connectLocal,getSyncStatus} from "../adapters/sync";
import { catalogGroups, matchesPartSearch } from "../domain/part-catalog";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  Link,
  LoaderCircle,
  Search,
  Unplug,
} from "lucide-react";
import { Field } from "./ui";
import { parseOnshapeUrl, type ImportProgress } from "../adapters/onshape";
import {
  HttpOnshapeAdapter,
  type LiveOnshapePartOption,
  type LiveOnshapeSelection,
  type OnshapeCapability,
  type OnshapeCatalogItem,
  type OnshapeConfigurations,
  type OnshapeElement,
} from "../adapters/onshape-http";
import type { Classification, Part } from "../domain/model";
import { editOnshapeConfiguration } from "./source-configuration";

/** This component contains no token or account forms. All live calls use the local server adapter. */
export default function LiveOnshapeIntake({
  onImport,
}: {
  onImport: (parts: Part[]) => void;
}) {
  const adapter = useRef(new HttpOnshapeAdapter()).current;
  const [capability, setCapability] = useState<OnshapeCapability>();
  const [checking, setChecking] = useState(true);
  const [syncStatus,setSyncStatus]=useState<Awaited<ReturnType<typeof getSyncStatus>>>();
  const authAbort=useRef<AbortController|null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<OnshapeCatalogItem[]>([]);
  const [nextDocumentOffset, setNextDocumentOffset] = useState<number>();
  const [document, setDocument] = useState<OnshapeCatalogItem>();
  const [versions, setVersions] = useState<OnshapeCatalogItem[]>([]);
  const [nextVersionOffset, setNextVersionOffset] = useState<number>();
  const [versionId, setVersionId] = useState("");
  const [elements, setElements] = useState<OnshapeElement[]>([]);
  const [elementId, setElementId] = useState("");
  const [configurations, setConfigurations] = useState<OnshapeConfigurations>();
  const [configuration, setConfiguration] = useState("default");
  const [configurationValues, setConfigurationValues] = useState<
    Record<string, string>
  >({});
  const [partQuery, setPartQuery] = useState("");
  const [assemblyScope, setAssemblyScope] = useState<string[]>([]);
  const [rootCatalog, setRootCatalog] = useState<LiveOnshapePartOption[]>([]);
  const [parts, setParts] = useState<LiveOnshapePartOption[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [classifications, setClassifications] = useState<
    Record<string, Classification>
  >({});
  const [spares, setSpares] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<ImportProgress>();
  const [transferred, setTransferred] = useState<Part[]>();
  const [dimensionsConfirmed, setDimensionsConfirmed] = useState(false);
  const [linkNotice, setLinkNotice] = useState("");
  const sequence = useRef(0);
  const alive = useRef(true);
  const transfer = useRef<AbortController | undefined>(undefined);
  const linkedPreference = useRef<
    | { documentId: string; elementId?: string; configuration?: string }
    | undefined
  >(undefined);

  useEffect(() => {
    alive.current = true;
    void checkConnection();
    return () => {
      alive.current = false;
      sequence.current++;
      transfer.current?.abort();
      authAbort.current?.abort();
    };
  }, []);

  async function checkConnection() {
    setChecking(true);
    void getSyncStatus().then(setSyncStatus).catch(()=>{});
    setError("");
    try {
      const status = await adapter.capability();
      if (alive.current) setCapability(status);
    } catch (e) {
      if (alive.current) {
        setCapability(undefined);
        setError(message(e));
      }
    } finally {
      if (alive.current) setChecking(false);
    }
  }
  const message = (e: unknown) =>
    e instanceof Error
      ? e.message
      : "Onshape could not complete this request. Retry after checking setup.";
  function clearParts(resetCatalog = true) {
    if(resetCatalog){setRootCatalog([]);setAssemblyScope([]);setPartQuery("");}
    setParts(undefined);
    setSelected([]);
    setTransferred(undefined);
    setDimensionsConfirmed(false);
  }
  function changeConfigurationParameter(id: string, value: string) {
    try {
      const result = editOnshapeConfiguration(
        configuration,
        configurationValues,
        id,
        value,
      );
      setConfigurationValues(result.values);
      setConfiguration(result.configuration);
      clearParts();
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }
  function clearElement() {
    setElements([]);
    setElementId("");
    setConfigurations(undefined);
    setConfiguration("default");
    setConfigurationValues({});
    clearParts();
  }
  function verified() {
    setCapability((value) => (value ? { ...value, verified: true } : value));
  }
  async function search(offset = 0) {
    const request = ++sequence.current;
    setBusy("Finding documents…");
    setError("");
    try {
      const result = await adapter.listDocuments(query.trim(), offset);
      if (!alive.current || request !== sequence.current) return;
      setDocuments((old) =>
        offset ? [...old, ...result.items] : result.items,
      );
      setNextDocumentOffset(result.nextOffset);
      verified();
      if (!result.items.length && !offset)
        setLinkNotice(
          "No documents found. Check the search or paste a document link shared with the configured account.",
        );
    } catch (e) {
      if (alive.current && request === sequence.current) setError(message(e));
    } finally {
      if (alive.current && request === sequence.current) setBusy("");
    }
  }
  async function loadDocument(
    chosen: OnshapeCatalogItem,
    preferred?: {
      versionId?: string;
      elementId?: string;
      configuration?: string;
    },
    offset = 0,
  ) {
    const request = ++sequence.current;
    setBusy("Loading immutable versions…");
    setError("");
    if (!offset) {
      linkedPreference.current = preferred
        ? {
            documentId: chosen.id,
            elementId: preferred.elementId,
            configuration: preferred.configuration,
          }
        : undefined;
      setDocument(chosen);
      setVersions([]);
      setVersionId("");
      clearElement();
    }
    try {
      const result = await adapter.listVersions(chosen.id, offset);
      if (!alive.current || request !== sequence.current) return;
      const loaded = offset ? [...versions, ...result.items] : result.items;
      // A pasted immutable version can be outside the first page; preserve its exact id, never substitute another revision.
      if (
        preferred?.versionId &&
        !loaded.some((v) => v.id === preferred.versionId)
      )
        loaded.unshift({
          id: preferred.versionId,
          name: `Version ${preferred.versionId} · from link`,
        });
      setVersions(loaded);
      setNextVersionOffset(result.nextOffset);
      verified();
      if (!loaded.length)
        setError(
          "This document has no named immutable versions. Create a reviewed version in Onshape, then retry. Workspace geometry is not imported.",
        );
      if (preferred?.versionId) {
        setVersionId(preferred.versionId);
        await loadElements(chosen.id, preferred.versionId, preferred, request);
      }
    } catch (e) {
      if (alive.current && request === sequence.current) setError(message(e));
    } finally {
      if (alive.current && request === sequence.current) setBusy("");
    }
  }
  async function openLink() {
    try {
      const parsed = parseOnshapeUrl(link);
      if (parsed.referenceType === "m") {
        setLinkNotice(
          "Microversion link recognized. Choose a named immutable version before importing; Foundry will not substitute this geometry silently.",
        );
      } else if (parsed.referenceType === "w") {
        setLinkNotice(
          "Workspace link recognized. Select a named immutable version before importing.",
        );
      } else
        setLinkNotice(
          "The immutable version from your link is pinned. Confirm its element and configuration.",
        );
      await loadDocument(
        { id: parsed.documentId, name: "Linked Onshape document" },
        {
          versionId: parsed.versionId,
          elementId: parsed.elementId,
          configuration: parsed.configuration,
        },
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function loadElements(
    did: string,
    vid: string,
    preferred?: { elementId?: string; configuration?: string },
    activeRequest?: number,
  ) {
    const request = activeRequest ?? ++sequence.current;
    if (!activeRequest) {
      setBusy("Loading design elements…");
      setError("");
    }
    clearElement();
    try {
      const result = await adapter.listElements(did, vid);
      if (!alive.current || request !== sequence.current) return;
      setElements(result);
      verified();
      const chosen = preferred?.elementId
        ? result.find((e) => e.id === preferred.elementId)
        : result.length === 1
          ? result[0]
          : undefined;
      if (preferred?.elementId && !chosen)
        setError(
          "The linked assembly or Part Studio is unavailable in this version. Choose a source element explicitly.",
        );
      if (!result.length)
        setError(
          "No supported assembly or Part Studio was found in this version.",
        );
      if (chosen) {
        setElementId(chosen.id);
        await loadConfiguration(
          did,
          vid,
          chosen.id,
          preferred?.configuration,
          request,
        );
      }
    } catch (e) {
      if (alive.current && request === sequence.current) setError(message(e));
    } finally {
      if (!activeRequest && alive.current && request === sequence.current)
        setBusy("");
    }
  }
  async function loadConfiguration(
    did: string,
    vid: string,
    eid: string,
    preferred?: string,
    activeRequest?: number,
  ) {
    const request = activeRequest ?? ++sequence.current;
    if (!activeRequest) {
      setBusy("Loading configurations…");
      setError("");
    }
    setConfigurations(undefined);
    clearParts();
    try {
      const result = await adapter.getConfigurations(did, vid, eid);
      if (!alive.current || request !== sequence.current) return;
      const initial =
        preferred && preferred !== "default"
          ? preferred
          : result.defaultConfiguration;
      setConfigurations(result);
      setConfiguration(initial);
      const supplied = Object.fromEntries(
        initial
          .split(";")
          .filter((p) => p.includes("="))
          .map((p) => {
            const index = p.indexOf("=");
            return [p.slice(0, index), p.slice(index + 1)];
          }),
      );
      setConfigurationValues(
        Object.fromEntries(
          result.parameters.map((p) => [
            p.id,
            supplied[p.id] ?? p.defaultValue,
          ]),
        ),
      );
      verified();
    } catch (e) {
      if (alive.current && request === sequence.current) setError(message(e));
    } finally {
      if (!activeRequest && alive.current && request === sequence.current)
        setBusy("");
    }
  }
  const element = elements.find((e) => e.id === elementId);
  const selection: LiveOnshapeSelection | undefined =
    document && versionId && element && configurations
      ? {
          documentId: document.id,
          versionId,
          elementId,
          elementType: element.type,
          configuration,
          assemblyScope,
        }
      : undefined;
  async function loadParts(scope: string[] = []) {
    if (!selection) return;
    const request = ++sequence.current;
    setBusy("Reading parts and assembly quantities…");
    setError("");
    clearParts(false);
    setAssemblyScope(scope);
    try {
      const result = await adapter.listParts({...selection,assemblyScope:scope});
      if (!alive.current || request !== sequence.current) return;
      setParts(result);
      if(!scope.length)setRootCatalog(result);
      setClassifications(
        Object.fromEntries(result.map((p) => [p.id, p.classification])),
      );
      setSelected(
        result
          .filter(
            (p) => p.available && p.classification !== "buy" && p.quantity > 0,
          )
          .map((p) => p.id),
      );
      setSpares({});
      verified();
      if (!result.length)
        setError(
          "No active parts were found in this configuration. Review suppressed components and the selected source element in Onshape.",
        );
    } catch (e) {
      if (alive.current && request === sequence.current) setError(message(e));
    } finally {
      if (alive.current && request === sequence.current) setBusy("");
    }
  }
  async function importParts() {
    if (!selection || !selected.length) return;
    setBusy("Transferring geometry…");
    setError("");
    setTransferred(undefined);
    setDimensionsConfirmed(false);
    transfer.current = new AbortController();
    try {
      const result = await adapter.importParts(
        {
          ...selection,
          partIds: selected,
          spares,
          classifications,
          excludePurchased: true,
        },
        {
          signal: transfer.current.signal,
          onProgress: (value) => {
            if (alive.current) setProgress(value);
          },
        },
      );
      if (alive.current && !transfer.current.signal.aborted) {
        setTransferred(result);
        verified();
      }
    } catch (e) {
      if (alive.current)
        setError(
          transfer.current.signal.aborted
            ? "Geometry transfer cancelled. No parts were added. You can retry the same selection."
            : message(e),
        );
    } finally {
      if (alive.current) {
        setBusy("");
        setProgress(undefined);
      }
    }
  }
  const selectedParts = parts?.filter((p) => selected.includes(p.id)) ?? [];
  const invalidSpares = selectedParts.some(
    (p) =>
      !Number.isInteger(spares[p.id] ?? 0) ||
      (spares[p.id] ?? 0) < 0 ||
      (spares[p.id] ?? 0) > 999,
  );
  const reviewCount = selectedParts.filter(
    (p) => classifications[p.id] === "review",
  ).length;

  return (
    <div className="live-intake">
      {checking ? (
        <div className="loading" role="status">
          <LoaderCircle size={16} className="spin" /> Checking local Onshape
          setup…
        </div>
      ) : capability?.available ? (
        <p className="source-connection-status">
          <Check size={14} />{" "}
          {capability.verified
            ? "Onshape access verified by an upstream request."
            : "Onshape adapter configured. Access is verified when a design is requested."}
        </p>
      ) : (
        <div className="source-setup">
          <Unplug size={20} />
          <div>
            <h3>Onshape setup required</h3>
            <p>
              {capability?.reason ??
                "The local Onshape service could not be reached."}
            </p>
            <p>{syncStatus?.configured?'Sign in to your team and connect Onshape in your browser. Foundry renews access securely; no token file is needed.':'Open Project → Team sync & records to enter the team service URL once. Then sign in and connect Onshape.'}</p>
            {syncStatus?.configured&&<button className="btn primary" disabled={!!busy} onClick={()=>{setBusy('Waiting for your browser…');const abort=new AbortController();authAbort.current=abort;void (async()=>{try{if(!syncStatus.signedIn)await connectLocal('github',abort.signal);await connectLocal('onshape',abort.signal);await checkConnection();}catch(e){if(!abort.signal.aborted)setError(message(e));}finally{if(alive.current)setBusy('');}})();}}>Connect Onshape</button>}
            <details><summary>Advanced token-file connection</summary><p>An administrator can still configure ONSHAPE_ACCESS_TOKEN_FILE for an existing authorized provider. The browser connection uses the team service and avoids manual token replacement. See docs/ONSHAPE.md.</p></details>
            <button
              className="btn"
              onClick={() => void checkConnection()}
              disabled={checking}
            >
              Check connection
            </button>
          </div>
        </div>
      )}

      <fieldset
        disabled={!capability?.available || !!busy || checking}
        className="source-stage"
      >
        <legend>
          <span>1</span> Find your design
        </legend>
        <Field label="Onshape design link">
          <div className="source-search-row">
            <input
              aria-label="Onshape document link"
              placeholder="https://cad.onshape.com/documents/…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void openLink();
                }
              }}
            />
            <button
              className="btn"
              disabled={!link.trim()}
              onClick={() => void openLink()}
            >
              <Link size={14} /> Open design
            </button>
          </div>
        </Field>
        <details>
          <summary>Find a document by name</summary>
          <Field label="Document search">
            <div className="source-search-row">
              <input
                aria-label="Document search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search();
                  }
                }}
              />
              <button className="btn" onClick={() => void search()}>
                <Search size={14} /> Search documents
              </button>
            </div>
          </Field>
          <div className="source-document-results">
            {documents.map((d) => (
              <button
                className={`source-document ${d.id === document?.id ? "selected" : ""}`}
                key={d.id}
                onClick={() => {
                  setLinkNotice("");
                  void loadDocument(d);
                }}
              >
                {d.name}
                <small>{d.id}</small>
              </button>
            ))}
          </div>
          {nextDocumentOffset !== undefined && (
            <button
              className="linkbutton"
              onClick={() => void search(nextDocumentOffset)}
            >
              More documents
            </button>
          )}
        </details>
        {linkNotice && (
          <p className="smalltext" role="status">
            {linkNotice}
          </p>
        )}
      </fieldset>

      {document && (
        <fieldset disabled={!!busy} className="source-stage">
          <legend>
            <span>2</span> Pin the source
          </legend>
          <p className="source-pinned-document">
            {document.name}
            <small>{document.id}</small>
          </p>
          <div className="fieldrow">
            <Field label="Immutable version">
              <select
                aria-label="Immutable Onshape version"
                value={versionId}
                onChange={(e) => {
                  setVersionId(e.target.value);
                  if (e.target.value)
                    void loadElements(
                      document.id,
                      e.target.value,
                      linkedPreference.current?.documentId === document.id
                        ? linkedPreference.current
                        : undefined,
                    );
                  else {
                    sequence.current++;
                    clearElement();
                  }
                }}
              >
                <option value="">Choose a named version…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assembly or Part Studio">
              <select
                aria-label="Onshape source element"
                value={elementId}
                disabled={!versionId || !elements.length}
                onChange={(e) => {
                  setElementId(e.target.value);
                  if (e.target.value)
                    void loadConfiguration(
                      document.id,
                      versionId,
                      e.target.value,
                    );
                  else {
                    setConfigurations(undefined);
                    clearParts();
                  }
                }}
              >
                <option value="">Choose a source element…</option>
                {elements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ·{" "}
                    {e.type === "assembly" ? "Assembly" : "Part Studio"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {nextVersionOffset !== undefined && (
            <button
              className="linkbutton"
              onClick={() =>
                void loadDocument(document, undefined, nextVersionOffset)
              }
            >
              More versions
            </button>
          )}
          {!!configurations?.parameters.length && (
            <details open>
              <summary>Configuration</summary>
              {configurations.parameters.map((parameter) => (
                <Field key={parameter.id} label={parameter.name}>
                  {parameter.type === "enum" || parameter.type === "boolean" ? (
                    <select
                      aria-label={`Onshape configuration ${parameter.name}`}
                      value={
                        configurationValues[parameter.id] ??
                        parameter.defaultValue
                      }
                      onChange={(e) => {
                        changeConfigurationParameter(
                          parameter.id,
                          e.target.value,
                        );
                      }}
                    >
                      {(
                        parameter.options ?? [
                          { id: "true", name: "True" },
                          { id: "false", name: "False" },
                        ]
                      ).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`Onshape configuration ${parameter.name}`}
                      value={
                        configurationValues[parameter.id] ??
                        parameter.defaultValue
                      }
                      onChange={(e) => {
                        changeConfigurationParameter(
                          parameter.id,
                          e.target.value,
                        );
                      }}
                    />
                  )}
                </Field>
              ))}
            </details>
          )}
          <details className="source-exact-config">
            <summary>Exact configuration identifier</summary>
            <Field
              label="Raw Onshape configuration"
              hint="Preserved from your link. Use this advanced field for complex values; manufacturing geometry is imported only after Load parts."
            >
              <input
                aria-label="Exact Onshape configuration"
                value={configuration}
                onChange={(e) => {
                  setConfiguration(e.target.value);
                  const rawValues = Object.fromEntries(
                    e.target.value
                      .split(";")
                      .filter((entry) => entry.includes("="))
                      .map((entry) => {
                        const separator = entry.indexOf("=");
                        return [
                          entry.slice(0, separator),
                          entry.slice(separator + 1),
                        ];
                      }),
                  );
                  setConfigurationValues(
                    Object.fromEntries(
                      (configurations?.parameters ?? []).map((parameter) => [
                        parameter.id,
                        rawValues[parameter.id] ?? parameter.defaultValue,
                      ]),
                    ),
                  );
                  clearParts();
                }}
              />
            </Field>
          </details>
          <button
            className="btn primary"
            disabled={!selection}
            onClick={() => void loadParts()}
          >
            Load parts
          </button>
        </fieldset>
      )}

      {parts && !transferred && (
        <fieldset disabled={!!busy} className="source-stage">
          <legend>
            <span>3</span> Choose what to make
          </legend>
          <p className="smalltext">
            Assembly occurrences determine CAD quantity. Add spares explicitly.
            CAD material and colour remain hints; filament is selected during
            preparation.
          </p>
          <div className="catalog-controls">
            <label className="field">Find a part<input aria-label="Search CAD parts" placeholder="Name, part ID, material or subsystem" value={partQuery} onChange={e=>setPartQuery(e.target.value)}/></label>
            {element?.type==='assembly' && <label className="field">Assembly / subsystem<select aria-label="CAD assembly scope" value={JSON.stringify(assemblyScope)} onChange={e=>void loadParts(JSON.parse(e.target.value))}>
              <option value="[]">Entire assembly</option>
              {catalogGroups(rootCatalog).map(group=><option key={group.id} value={group.id}>{group.label} · {group.quantity} occurrences</option>)}
            </select></label>}
            <p className="smalltext">{parts.filter(p=>matchesPartSearch(p,partQuery)).length} of {parts.length} part types shown. Search keeps your selection. Choosing a subsystem reloads its exact quantities and resets selection.</p>
            <button className="btn" onClick={()=>setSelected(parts.filter(p=>matchesPartSearch(p,partQuery)&&p.available&&classifications[p.id]!=='buy').map(p=>p.id))}>Select search results only</button>
          </div>
          <div className="source-selection-actions">
            <span>
              {selected.length} part types ·{" "}
              {selectedParts.reduce(
                (total, p) => total + p.quantity + (spares[p.id] ?? 0),
                0,
              )}{" "}
              copies including spares
            </span>
            <button
              className="btn"
              disabled={!selected.length}
              onClick={() =>
                setClassifications((old) => ({
                  ...old,
                  ...Object.fromEntries(
                    selected.map((id) => [id, "make" as const]),
                  ),
                }))
              }
            >
              Mark selected as make
            </button>
          </div>
          <div className="source-table-scroll">
            <table className="source-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Part</th>
                  <th>CAD qty</th>
                  <th>Backup parts</th>
                  <th>Manufacture?</th>
                </tr>
              </thead>
              <tbody>
                {parts.filter(p=>matchesPartSearch(p,partQuery)).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select live ${p.name}`}
                        checked={selected.includes(p.id)}
                        disabled={
                          !p.available || classifications[p.id] === "buy"
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {p.name}
                      <small>{p.assemblyMemberships?.map(m=>m.names.join(" / ")).join(" · ") || p.originElementName}</small>
                      <small>
                        {p.dimensions
                          ? `${p.dimensions.map((n) => n.toFixed(2)).join(" × ")} mm`
                          : "Dimensions verified during geometry transfer"}
                        {p.linkedDocumentId ? " · linked document" : ""}
                      </small>
                      {!p.available && (
                        <small className="source-unavailable">
                          {p.unavailableReason ??
                            "Linked part unavailable. Resolve access or leave it excluded."}
                        </small>
                      )}
                    </td>
                    <td>{p.quantity}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        step={1}
                        aria-label={`Live spares for ${p.name}`}
                        value={spares[p.id] ?? 0}
                        disabled={!selected.includes(p.id)}
                        onChange={(e) =>
                          setSpares({
                            ...spares,
                            [p.id]: Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Manufacturing choice for ${p.name}`}
                        value={classifications[p.id] ?? "review"}
                        onChange={(e) => {
                          const choice = e.target.value as Classification;
                          setClassifications({
                            ...classifications,
                            [p.id]: choice,
                          });
                          if (choice === "buy")
                            setSelected(selected.filter((id) => id !== p.id));
                        }}
                      >
                        <option value="review">Review required</option>
                        <option value="make">Make</option>
                        <option value="buy">Purchased · exclude</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reviewCount > 0 && (
            <p className="smalltext">
              {reviewCount} selected part type
              {reviewCount === 1 ? " needs" : "s need"} a manufacturing
              decision. You can import for inspection; approval remains blocked
              until classification is reviewed.
            </p>
          )}
          {invalidSpares && (
            <p className="notice error">
              Spare quantities must be whole numbers from 0 through 999.
            </p>
          )}
          <button
            className="btn primary"
            disabled={!selected.length || invalidSpares}
            onClick={() => void importParts()}
          >
            <ArrowDownToLine size={14} /> Transfer selected parts
          </button>
        </fieldset>
      )}

      {transferred && (
        <section
          className="source-stage"
          aria-label="Verify transferred geometry"
        >
          <h3>
            <span className="source-step-number">3</span> Verify imported
            dimensions
          </h3>
          <p>
            Original STL bytes and SHA-256 hashes are preserved. Manufacturing
            dimensions are explicit millimetres. Geometry is not silently
            repaired or rescaled.
          </p>
          <ul className="source-geometry-review">
            {transferred.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>
                <span>
                  {p.geometry.dimensions.map((n) => n.toFixed(2)).join(" × ")}{" "}
                  mm · {p.quantity} CAD + {p.spareQuantity} spare
                </span>
                <code>{p.geometry.hash.slice(0, 16)}…</code>
                {p.geometry.warnings?.map((warning, i) => (
                  <p className="notice error" key={i}>
                    Geometry review required: {warning}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <label className="togglelabel">
            <input
              type="checkbox"
              checked={dimensionsConfirmed}
              onChange={(e) => setDimensionsConfirmed(e.target.checked)}
            />{" "}
            I checked the imported dimensions against Onshape.
          </label>
          <div className="source-review-actions">
            <button
              className="btn"
              onClick={() => {
                setTransferred(undefined);
                setDimensionsConfirmed(false);
              }}
            >
              Back to part selection
            </button>
            <button
              className="btn primary"
              disabled={!dimensionsConfirmed}
              onClick={() => onImport(transferred)}
            >
              <Check size={14} /> Add verified parts
            </button>
          </div>
        </section>
      )}
      {busy && (
        <div className="loading" role="status">
          <LoaderCircle size={16} className="spin" />
          <div>
            {progress?.message ?? busy}
            {progress && (
              <div className="progressbar">
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, progress.percent))}%`,
                  }}
                />
              </div>
            )}
            {transfer.current &&
              !transfer.current.signal.aborted &&
              progress && (
                <button
                  className="linkbutton"
                  onClick={() => transfer.current?.abort()}
                >
                  Cancel transfer
                </button>
              )}
          </div>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
