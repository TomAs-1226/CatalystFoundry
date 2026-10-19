import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  DocumentedOnshapeAdapter,
  ONSHAPE_API_VERSION,
  OnshapeError,
  resolveAssemblyParts,
  type AssemblyDefinition,
  type ImmutablePartRef,
  type OnshapeTransport,
} from "../src/adapters/onshape";
import type {
  LiveOnshapeSelection,
  LiveOnshapePartOption,
  OnshapeCapability,
  OnshapeCatalogItem,
  OnshapeConfigurationParameter,
  OnshapeConfigurations,
  OnshapeElement,
  OnshapeImportJob,
  OnshapePage,
} from "../src/adapters/onshape-http";
import type { GeometryAsset, Part, Vec3 } from "../src/domain/model";
import {
  GeometryImportError,
  geometrySHA256,
  parseSTL,
} from "../src/adapters/geometry";
import { createOAuthOnshapeTransport, OnshapeHttpError } from "./onshape";
import {mapBounded} from '../src/domain/robot-plan';
import {immutableOnshapeCache} from './onshape-cache';

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const rows = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : Array.isArray(object(value).items)
      ? (object(value).items as unknown[])
      : [];
const idPattern = /^[a-f\d]{24}$/i;
const abort = () =>
  new DOMException(
    "Geometry transfer cancelled. No parts were imported.",
    "AbortError",
  );
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abort();
};
export interface OnshapeServiceOptions {
  transport?: OnshapeTransport;
  connectionStatus?:()=>Promise<{available:boolean;reason:string}>;
  tokenFile?: string;
  artifactHosts?: string[];
  exportMode?: "sync-stl" | "async-stl";
  /** Async translator values are deployment-specific and must be qualified against known dimensions. */
  asyncUnit?: string;
  asyncOutputUnits?: "mm" | "in";
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  onImported?:(parts:Part[],selection:LiveOnshapeSelection)=>Promise<NonNullable<OnshapeImportJob['sharing']>>;
}

/** Local single-operator integration service. It is not a multi-user OAuth callback or token issuer. */
export class OnshapeService {
  private adapter: DocumentedOnshapeAdapter;
  private verified = false;
  private jobs = new Map<
    string,
    { view: OnshapeImportJob; controller: AbortController }
  >();
  private cache = new Map<string, GeometryAsset>();
  private activeImports = 0;
  private metadataCache?:ReturnType<typeof immutableOnshapeCache>;
  constructor(private options: OnshapeServiceOptions = {}) {
    const transport =
      options.transport ??
      (options.tokenFile
        ? createOAuthOnshapeTransport({
            getAccessToken: async () => {
              const info = await stat(options.tokenFile!).catch(
                () => undefined,
              );
              if (!info?.isFile() || info.size > 16_384)
                throw new OnshapeHttpError(
                  503,
                  "The configured Onshape token file is unavailable or invalid. Replace it with a server-owned OAuth access-token file and retry.",
                );
              const token = (await readFile(options.tokenFile!, "utf8")).trim();
              if (!token || /\s/.test(token))
                throw new OnshapeHttpError(
                  503,
                  "The configured Onshape token file must contain only the OAuth access token. Re-authorise outside Foundry and replace the file.",
                );
              return token;
            },
            artifactHosts: options.artifactHosts,
            fetcher: options.fetcher,
          })
        : undefined);
    this.metadataCache=transport?immutableOnshapeCache(transport):undefined;
    this.adapter = new DocumentedOnshapeAdapter(this.metadataCache?.transport);
  }
  async capability(): Promise<OnshapeCapability> {
    const connection=await this.options.connectionStatus?.();
    let available = this.adapter.available && (connection?.available??true);
    if (this.options.tokenFile)
      available =
        available &&
        (await access(this.options.tokenFile, constants.R_OK).then(
          () => true,
          () => false,
        ));
    return {
      available,
      mode: available ? "configured" : "disconnected",
      verified: available && this.verified,
      authentication: this.options.transport
        ? "injected-provider"
        : this.options.tokenFile
          ? "server-oauth-token-file"
          : "not-configured",
      exportMode: this.options.exportMode ?? "sync-stl",
      apiVersion: ONSHAPE_API_VERSION,
      reason: connection&&!connection.available?connection.reason:available
        ? this.verified
          ? "Onshape accepted a documented API request. Each document and export still requires permission."
          : "Server credential provider configured. Access has not been verified; search or open a document to check it."
        : this.options.tokenFile
          ? "The configured OAuth token file is not readable by the Foundry server. See Onshape setup."
          : "Live Onshape requires a server-owned OAuth access token. Configure ONSHAPE_ACCESS_TOKEN_FILE; no account is connected in this demo.",
    };
  }
  private async upstream<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.verified = true;
      return result;
    } catch (error) {
      if (
        error instanceof OnshapeHttpError &&
        [401, 403, 503].includes(error.status)
      )
        this.verified = false;
      throw error;
    }
  }
  resetConnection(){this.verified=false;this.cache.clear();this.metadataCache?.clear();for(const entry of this.jobs.values())entry.controller.abort();}
  private requireConfigured() {
    if (!this.adapter.available)
      throw new OnshapeHttpError(
        503,
        "Live Onshape is not configured. Set ONSHAPE_ACCESS_TOKEN_FILE on the local server after authorised OAuth login; or explicitly use demonstration fixtures.",
      );
  }
  async listDocuments(query = "", offset = 0): Promise<OnshapePage> {
    this.requireConfigured();
    const result = await this.upstream(() =>
      this.adapter.listDocuments(query, offset),
    );
    const items = rows(result)
      .filter((value) => {
        const r = object(value);
        return (
          idPattern.test(text(r.id)) &&
          r.isContainer !== true &&
          r.resourceType !== "folder"
        );
      })
      .map((value) => ({
        id: text(object(value).id),
        name: text(object(value).name, "Untitled document"),
      }));
    const rawNext = text(object(result).next);
    let nextOffset: number | undefined;
    if (rawNext) {
      const next = new URL(rawNext, "https://cad.onshape.com");
      const parsedOffset = Number(next.searchParams.get("offset"));
      if (
        next.origin !== "https://cad.onshape.com" ||
        !Number.isInteger(parsedOffset) ||
        parsedOffset <= offset
      )
        throw new OnshapeError(
          "INVALID_UPSTREAM_PAGE",
          "Onshape returned an invalid document page. Retry the search.",
        );
      nextOffset = parsedOffset;
    }
    return { items, ...(nextOffset !== undefined ? { nextOffset } : {}) };
  }
  async listVersions(documentId: string, offset = 0): Promise<OnshapePage> {
    this.requireConfigured();
    const result = rows(
      await this.upstream(() => this.adapter.listVersions(documentId, offset)),
    );
    const items = result
      .map((value) => ({
        id: text(object(value).id),
        name: text(object(value).name, "Unnamed immutable version"),
        ...(text(object(value).createdAt)&&Number.isFinite(Date.parse(text(object(value).createdAt)))?{createdAt:text(object(value).createdAt)}:{}),
      }))
      .filter((item) => idPattern.test(item.id));
    return {
      items,
      ...(result.length === 20 ? { nextOffset: offset + 20 } : {}),
    };
  }
  async listElements(
    documentId: string,
    versionId: string,
    signal?: AbortSignal,
  ): Promise<OnshapeElement[]> {
    this.requireConfigured();
    const result = rows(
      await this.upstream(() =>
        this.adapter.listElements(documentId, versionId, signal),
      ),
    );
    return result.flatMap((value) => {
      const r = object(value);
      const type = text(r.elementType || r.type).toUpperCase();
      return !r.deleted &&
        idPattern.test(text(r.id)) &&
        ["PARTSTUDIO", "ASSEMBLY"].includes(type)
        ? [
            {
              id: text(r.id),
              name: text(r.name, "Unnamed element"),
              type:
                type === "ASSEMBLY"
                  ? ("assembly" as const)
                  : ("partstudio" as const),
            },
          ]
        : [];
    });
  }
  async getConfigurations(
    documentId: string,
    versionId: string,
    elementId: string,
  ): Promise<OnshapeConfigurations> {
    this.requireConfigured();
    const result = object(
      await this.upstream(() =>
        this.adapter.getConfigurations(documentId, versionId, elementId),
      ),
    );
    const parameters: OnshapeConfigurationParameter[] = rows(
      result.configurationParameters,
    )
      .map((value) => {
        const r = object(value);
        const kind = text(r.btType || r.type) + " " + text(r.parameterType);
        const type: OnshapeConfigurationParameter["type"] = /Enum|ENUM/.test(
          kind,
        )
          ? "enum"
          : /Boolean|BOOLEAN/.test(kind)
            ? "boolean"
            : /Quantity|QUANTITY/.test(kind)
              ? "quantity"
              : "string";
        const options: OnshapeCatalogItem[] = rows(r.options).map((v) => ({
          id: text(object(v).option || object(v).id),
          name: text(
            object(v).optionName || object(v).name || object(v).option,
          ),
        }));
        if (!options.length && Array.isArray(r.optionIds))
          for (const [index, id] of r.optionIds.entries())
            options.push({
              id: text(id),
              name: text(
                (r.optionNames as unknown[] | undefined)?.[index],
                text(id),
              ),
            });
        const range = object(r.rangeAndDefault);
        const quantityDefault =
          typeof range.defaultValue === "number" &&
          Number.isFinite(range.defaultValue) &&
          text(range.units)
            ? `${range.defaultValue} ${text(range.units)}`
            : "";
        return {
          id: text(r.parameterId),
          name: text(r.parameterName || r.parameterId),
          type,
          defaultValue:
            type === "quantity"
              ? quantityDefault
              : typeof r.defaultValue === "boolean"
                ? String(r.defaultValue)
                : text(r.defaultValue),
          ...(type === "enum" ? { options } : {}),
        };
      })
      .filter((p) => !!p.id);
    return { parameters, defaultConfiguration: "default" };
  }
  async listParts(
    selection: LiveOnshapeSelection,
    signal?: AbortSignal,
    includeDimensions=true,
    onResolved?:(completed:number,total:number)=>void,
  ): Promise<LiveOnshapePartOption[]> {
    this.requireConfigured();
    // Check the real element kind rather than allowing a client to describe assembly geometry as a Part Studio.
    const elements = await this.listElements(
      selection.documentId,
      selection.versionId,
      signal,
    );
    const element = elements.find((e) => e.id === selection.elementId);
    if (!element || element.type !== selection.elementType)
      throw new OnshapeError(
        "INVALID_ELEMENT",
        "Choose an available assembly or Part Studio from the selected immutable version.",
      );
    if(element.type!=="assembly"&&selection.assemblyScope?.length)throw new OnshapeError("INVALID_ASSEMBLY_SCOPE","Choose an assembly before selecting a subsystem.");
    const ref = {
      documentId: selection.documentId,
      versionId: selection.versionId,
      elementId: selection.elementId,
      configuration: selection.configuration,
    };
    let parts: LiveOnshapePartOption[];
    if (selection.elementType === "assembly") {
      const raw = await this.upstream(() =>
        this.adapter.getAssembly(ref, signal),
      );
      if (
        !raw.rootAssembly ||
        !Array.isArray(raw.rootAssembly.instances) ||
        !Array.isArray(raw.rootAssembly.occurrences)
      )
        throw new OnshapeError(
          "INVALID_ASSEMBLY",
          "Onshape returned an incomplete assembly definition. No parts were accepted.",
        );
      const definition: AssemblyDefinition = structuredClone(raw);
      definition.rootAssembly.documentId = selection.documentId;
      definition.rootAssembly.elementId = selection.elementId;
      definition.rootAssembly.documentVersion = selection.versionId;
      definition.rootAssembly.configuration = selection.configuration;
      definition.subAssemblies ??= [];
      for (const node of [
        definition.rootAssembly,
        ...definition.subAssemblies,
      ]) {
        if (node.documentId === selection.documentId && !node.documentVersion)
          node.documentVersion = selection.versionId;
        for (const instance of node.instances)
          if (
            instance.documentId === selection.documentId &&
            !instance.documentVersion
          )
            instance.documentVersion = selection.versionId;
      }
      parts = resolveAssemblyParts(definition,{assemblyScope:selection.assemblyScope}).map((group) => ({
        id: group.key,
        partId: group.partId,
        name: group.name,
        documentId: group.documentId,
        versionId: group.versionId,
        microversionId: group.microversionId,
        elementId: group.elementId,
        configuration: group.configuration,
        quantity: group.quantity,
        occurrences: group.occurrences,
        assemblyMemberships:group.assemblyMemberships,
        originElementName:element.name,
        classification: group.standardContent?'buy':'review',
        standardContent:group.standardContent,
        available: group.available && !!group.versionId,
        ...(group.linkedDocumentId
          ? { linkedDocumentId: group.linkedDocumentId }
          : {}),
        ...(!group.versionId
          ? {
              unavailableReason:
                "This linked part has only a microversion reference. Pin it to an accessible named version in Onshape before intake; it was not substituted with the current workspace.",
            }
          : !group.available
            ? {
                unavailableReason:
                  "Onshape reports this occurrence unavailable. Check linked-document permissions or explicitly exclude it.",
              }
            : {}),
      }));
    } else {
      const result = rows(
        await this.upstream(() => this.adapter.getPartStudioParts(ref, signal)),
      );
      parts = result.map((value) => {
        const r = object(value);
        const partId = text(r.partId || r.id);
        const bodyType = text(r.bodyType).toLowerCase();
        const solid =
          !bodyType || bodyType === "solid" || bodyType === "solidbody";
        return {
          id: JSON.stringify([
            selection.documentId,
            selection.versionId,
            selection.elementId,
            partId,
            selection.configuration,
          ]),
          partId,
          name: text(r.name, partId),
          documentId: selection.documentId,
          versionId: selection.versionId,
          elementId: selection.elementId,
          configuration: selection.configuration,
          quantity: 1,
          occurrences: [],
          classification: "review" as const,
          available: !!partId && solid && !r.isMesh,
          ...(!solid || r.isMesh
            ? {
                unavailableReason:
                  "This item is not a separated solid CAD part. Review it in Onshape; Foundry does not split, merge or repair geometry.",
              }
            : {}),
          ...(text(object(r.material).displayName)
            ? { materialHint: `CAD: ${text(object(r.material).displayName)}` }
            : {}),
        };
      });
    }
    if(selection.elementType==='assembly'){
      const studios=new Map<string,LiveOnshapePartOption[]>();
      for(const part of parts){if(!part.available||selection.partIds&&!selection.partIds.includes(part.id))continue;const key=JSON.stringify([part.documentId,part.versionId,part.elementId,part.configuration]);const list=studios.get(key)??[];list.push(part);studios.set(key,list);}
      await mapBounded([...studios.values()],4,async group=>{
        try{const metadata=rows(await this.upstream(()=>this.adapter.getPartStudioParts(this.ref(group[0],selection.documentId),signal)));
          for(const part of group){const meta=metadata.map(object).find(row=>text(row.partId||row.id)===part.partId);if(!meta)continue;const material=text(object(meta.material).displayName);if(material)part.materialHint=`CAD: ${material}`;}
        }catch(error){if(signal?.aborted||error instanceof OnshapeHttpError&&[401,402,409,429,503].includes(error.status))throw error;}
      });
    }
    if(!includeDimensions)return parts;
    // Bounding boxes are native CAD SI metres. Retain explicit mm conversion and validate exported STL against these extents.
    // One denied linked item remains visible and unavailable; its successful neighbours are never silently imported in its place.
    const dimensionParts=parts.filter(part=>part.available&&(!selection.partIds||selection.partIds.includes(part.id)));
    let resolved=0;
    await mapBounded(dimensionParts,4,async part=>{
      try {
        const box = await this.upstream(() =>
          this.adapter.getPartBoundingBox(
            this.ref(part, selection.documentId),
            signal,
          ),
        );
        const dimensions = [
          box.highX - box.lowX,
          box.highY - box.lowY,
          box.highZ - box.lowZ,
        ].map((v) => v * 1000) as Vec3;
        if (dimensions.some((n) => !Number.isFinite(n) || n <= 0))
          throw new OnshapeError(
            "INVALID_DIMENSIONS",
            "CAD bounding box is empty or invalid. Review this part in Onshape.",
          );
        part.dimensions = dimensions;
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof OnshapeHttpError &&
            [401, 402, 409, 429, 503].includes(error.status))
        )
          throw error;
        part.available = false;
        part.unavailableReason =
          error instanceof Error
            ? error.message
            : "CAD dimensions are unavailable.";
      }
      onResolved?.(++resolved,dimensionParts.length);
    });
    return parts;
  }
  private ref(
    part: LiveOnshapePartOption,
    originDocumentId: string,
  ): ImmutablePartRef {
    if (!part.versionId)
      throw new OnshapeError(
        "IMMUTABLE_VERSION_REQUIRED",
        "This source part needs an accessible immutable named version.",
      );
    return {
      documentId: part.documentId,
      versionId: part.versionId,
      elementId: part.elementId,
      partId: part.partId,
      configuration: part.configuration,
      ...(part.documentId !== originDocumentId
        ? { linkDocumentId: originDocumentId }
        : {}),
    };
  }
  shutdown() {
    for (const [id, item] of this.jobs)
      if (["queued", "running"].includes(item.view.state))
        this.cancelImport(id);
  }
  getImport(id: string): OnshapeImportJob | undefined {
    const item = this.jobs.get(id);
    return item ? structuredClone(item.view) : undefined;
  }
  startImport(selection: LiveOnshapeSelection): OnshapeImportJob {
    this.requireConfigured();
    if (this.activeImports >= 2)
      throw new OnshapeHttpError(
        429,
        "Two geometry transfers are already active. Cancel one or wait before retrying.",
      );
    const controller = new AbortController();
    const view: OnshapeImportJob = {
      id: randomUUID(),
      state: "queued",
      progress: {
        phase: "queued",
        percent: 0,
        message: "Immutable Onshape geometry transfer queued.",
      },
    };
    const item = { view, controller };
    this.jobs.set(view.id, item);
    this.activeImports++;
    // Bound retained results. The project owns accepted geometry; this transient import queue is not durable storage.
    if (this.jobs.size > 30)
      for (const [id, job] of this.jobs) {
        if (!["queued", "running"].includes(job.view.state) && id !== view.id) {
          this.jobs.delete(id);
          break;
        }
      }
    void this.performImport(structuredClone(selection), item).finally(() => {
      this.activeImports--;
    });
    return structuredClone(view);
  }
  cancelImport(id: string): OnshapeImportJob {
    const item = this.jobs.get(id);
    if (!item)
      throw new OnshapeHttpError(
        404,
        "Geometry transfer not found. An interrupted server transfer must be started again.",
      );
    if (["done", "failed", "cancelled"].includes(item.view.state))
      return structuredClone(item.view);
    item.controller.abort();
    item.view.state = "cancelled";
    delete item.view.parts;
    item.view.progress = {
      phase: "cancelled",
      percent: item.view.progress.percent,
      message:
        "Local transfer cancelled; no parts accepted. An already-running Onshape export may still finish remotely.",
    };
    return structuredClone(item.view);
  }
  private async performImport(
    selection: LiveOnshapeSelection,
    item: { view: OnshapeImportJob; controller: AbortController },
  ) {
    const signal = item.controller.signal;
    const report = (
      phase: OnshapeImportJob["progress"]["phase"],
      percent: number,
      message: string,
      partId?: string,
    ) => {
      if (!signal.aborted)
        item.view.progress = { phase, percent, message, partId };
    };
    try {
      item.view.state = "running";
      report('resolving',1,'Resolving the saved CAD selection; progress measures completed stages, not download bytes.');
      const available = await this.listParts(selection, signal,true,(completed,total)=>report('resolving',Math.round(5+completed/Math.max(1,total)*15),`Checked CAD dimensions for ${completed} of ${total} part types.`));
      checkAbort(signal);
      const ids =
        selection.partIds ??
        available
          .filter(
            (p) => p.available && selection.classifications?.[p.id] === "make",
          )
          .map((p) => p.id);
      if (!ids.length)
        throw new OnshapeError(
          "NO_SELECTION",
          "Select at least one available part and explicitly classify it for manufacture.",
        );
      if (new Set(ids).size !== ids.length)
        throw new OnshapeError(
          "DUPLICATE_SELECTION",
          "A part was selected twice. Reconcile its manufacturing quantity instead.",
        );
      const result: Part[] = [];
      let batchSize = 0;
      for (const [index, id] of ids.entries()) {
        checkAbort(signal);
        const part = available.find((p) => p.id === id);
        if (!part)
          throw new OnshapeError(
            "UNKNOWN_PART",
            "A selected source part is no longer in this immutable selection. Reload parts and review the selection.",
          );
        const classification = selection.classifications?.[id] ?? "review";
        if (classification === "buy" && selection.excludePurchased !== false)
          continue;
        if (!part.available || !part.dimensions)
          throw new OnshapeError(
            "UNAVAILABLE_LINK",
            `${part.name}: ${part.unavailableReason ?? "CAD dimensions or linked geometry are unavailable."}`,
          );
        const spareQuantity = selection.spares?.[id] ?? 0;
        if (
          !Number.isInteger(spareQuantity) ||
          spareQuantity < 0 ||
          spareQuantity > 999
        )
          throw new OnshapeError(
            "INVALID_QUANTITY",
            "Spare quantities must be whole numbers from 0 through 999.",
          );
        const cacheKey = JSON.stringify([
          part.id,
          this.options.exportMode ?? "sync-stl",
          this.options.asyncUnit,
          this.options.asyncOutputUnits,
        ]);
        let geometry = this.cache.get(cacheKey);
        if (!geometry) {
          const ref = this.ref(part, selection.documentId);
          if (this.options.exportMode === "async-stl") {
            if (!this.options.asyncUnit || !this.options.asyncOutputUnits)
              throw new OnshapeError(
                "UNITS_REQUIRED",
                "Async STL needs both ONSHAPE_ASYNC_STL_UNIT and ONSHAPE_ASYNC_OUTPUT_UNITS configured and qualified against known CAD dimensions. Use the default sync STL path until then.",
              );
            const formats = await this.upstream(() =>
              this.adapter.supportedGeometryFormats(signal),
            );
            if (!formats.length)
              throw new OnshapeError(
                "UNSUPPORTED_FORMAT",
                "Onshape does not advertise an STL destination for this authorised deployment.",
              );
            const bytes = await this.upstream(() =>
              this.adapter.translatePart(ref, {
                formatName: formats[0].name,
                unit: this.options.asyncUnit!,
                signal,
                pollIntervalMs: this.options.pollIntervalMs,
                onProgress: (state) =>
                  report(
                    state.requestState === "DONE"
                      ? "downloading"
                      : "translating",
                    Math.round(20+(index / ids.length) * 70),
                    `${part.name}: Onshape translation ${state.requestState.toLowerCase()}.`,
                    id,
                  ),
              }),
            );
            checkAbort(signal);
            report(
              "validating",
              Math.round(20+((index + 0.8) / ids.length) * 70),
              `Checking declared units, CAD dimensions and geometry hash: ${part.name}.`,
              id,
            );
            geometry = await parseSTL(bytes, this.options.asyncOutputUnits, {
              name: `${part.name}.stl`,
              expectedDimensions: part.dimensions,
            });
          } else {
            report(
              "downloading",
              Math.round(20+(index / ids.length) * 70),
              `Requesting ${part.name} directly from Onshape as STL; explicit inches → mm.`,
              id,
            );
            geometry = await this.upstream(() =>
              this.adapter.exportPartStl(ref, part.dimensions!, signal),
            );
          }
          checkAbort(signal);
          this.cache.set(cacheKey, structuredClone(geometry));
          while (
            this.cache.size > 30 ||
            [...this.cache.values()].reduce(
              (sum, g) => sum + g.stl.length + (g.original?.data.length ?? 0),
              0,
            ) >
              32 * 1024 * 1024
          )
            this.cache.delete(this.cache.keys().next().value!);
        } else
          report(
            "cached",
            Math.round(20+((index + 0.8) / ids.length) * 70),
            `Using exact immutable source geometry: ${part.name}.`,
            id,
          );
        batchSize +=
          geometry.stl.length + (geometry.original?.data.length ?? 0);
        if (batchSize > 24 * 1024 * 1024)
          throw new OnshapeError(
            "BATCH_TOO_LARGE",
            "Combined geometry exceeds the 24 MiB saved-project budget. Import fewer parts or reduce tessellation in CAD; no partial batch was accepted.",
          );
        result.push({
          id: `onshape:${await geometrySHA256(JSON.stringify([part.id,selection.documentId,selection.versionId,selection.elementId,selection.configuration,selection.assemblyScope??[]]))}`,
          name: part.name,
          geometry: structuredClone(geometry),
          quantity: part.quantity,
          spareQuantity,
          category: "custom",
          classification,
          materialHint: part.materialHint,
          colorHint: part.colorHint,
          notes:
            "Imported through the documented Onshape API. CAD appearance is a hint; confirm manufacturing material and intended use separately.",
          source: {
            kind: "onshape",
            documentId: part.documentId,
            originDocumentId: selection.documentId,
            originVersionId: selection.versionId,
            originElementId: selection.elementId,
            originConfiguration: selection.configuration,
            originElementName:part.originElementName,
            assemblyScope:selection.assemblyScope,
            assemblyMemberships:part.assemblyMemberships,
            elementId: part.elementId,
            elementType: "partstudio",
            partId: part.partId,
            versionId: part.versionId,
            microversionId: part.microversionId,
            revision: part.versionId,
            configuration: part.configuration,
            url: `https://cad.onshape.com/documents/${part.documentId}/v/${part.versionId}/e/${part.elementId}?configuration=${encodeURIComponent(part.configuration)}`,
            occurrences: part.occurrences,
            installedTransformUnits: "m",
            linkedDocumentId: part.linkedDocumentId,
            available: true,
          },
        });
      }
      checkAbort(signal);
      if (!result.length)
        throw new OnshapeError(
          "NO_MANUFACTURED_PARTS",
          "All selected parts were explicitly excluded as purchased. Select an intended manufactured part.",
        );
      if(this.options.onImported){item.view.sharing=await this.options.onImported(result,selection);checkAbort(signal);}
      item.view.parts = result;
      item.view.state = "done";
      report(
        "done",
        100,
        `${result.length} part types transferred. Verify dimensions and classification before preparation.`,
      );
    } catch (error) {
      delete item.view.parts;
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        item.view.state = "cancelled";
        item.view.progress = {
          phase: "cancelled",
          percent: item.view.progress.percent,
          message: "Transfer cancelled. No parts were accepted.",
        };
      } else {
        item.view.state = "failed";
        item.view.error =
          error instanceof Error
            ? error.message
            : "Geometry transfer failed. Retry the source selection.";
        item.view.code =
          error instanceof OnshapeError || error instanceof GeometryImportError
            ? error.code
            : error instanceof OnshapeHttpError
              ? `HTTP_${error.status}`
              : "IMPORT_FAILED";
        item.view.progress = {
          phase: "failed",
          percent: item.view.progress.percent,
          message: item.view.error,
        };
      }
    }
  }
}

export function createConfiguredOnshapeService(
  options: OnshapeServiceOptions = {},
): OnshapeService {
  return new OnshapeService({
    tokenFile: process.env.ONSHAPE_ACCESS_TOKEN_FILE,
    artifactHosts: process.env.ONSHAPE_ARTIFACT_HOSTS?.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    exportMode:
      process.env.ONSHAPE_EXPORT_MODE === "async-stl"
        ? "async-stl"
        : "sync-stl",
    asyncUnit: process.env.ONSHAPE_ASYNC_STL_UNIT,
    asyncOutputUnits:
      process.env.ONSHAPE_ASYNC_OUTPUT_UNITS === "mm"
        ? "mm"
        : process.env.ONSHAPE_ASYNC_OUTPUT_UNITS === "in"
          ? "in"
          : undefined,
    ...options,
  });
}
