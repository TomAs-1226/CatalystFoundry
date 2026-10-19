import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { createOAuthOnshapeTransport } from "../server/onshape";
import { OnshapeService } from "../server/onshape-service";
import {
  HttpOnshapeAdapter,
  type LiveOnshapeSelection,
  type OnshapeImportJob,
} from "../src/adapters/onshape-http";
import {
  approveJob,
  attachToolpath,
  createJob,
  createProject,
  deserializeProject,
  fingerprint,
  invalidateChangedJobs,
  isApprovalCurrent,
  reviewToolpath,
  serializeProject,
} from "../src/domain";

const did = "aaaaaaaaaaaaaaaaaaaaaaaa",
  vid = "bbbbbbbbbbbbbbbbbbbbbbbb",
  eid = "cccccccccccccccccccccccc";
const linkedDid = "dddddddddddddddddddddddd",
  linkedVersion = "eeeeeeeeeeeeeeeeeeeeeeee";
const assemblyEid = "ffffffffffffffffffffffff";
const base: LiveOnshapeSelection = {
  documentId: did,
  versionId: vid,
  elementId: eid,
  elementType: "partstudio",
  configuration: "size=25 mm;side=left",
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mmStl = await readFile(
  new URL("../public/fixtures/bracket.stl", import.meta.url),
  "utf8",
);

it('reports resolution and download stages, and reuses geometry on repeated exact imports',async()=>{
 let release!:()=>void;const waitForDownload=new Promise<void>(resolve=>{release=resolve;});
 const fetcher=upstream({waitForDownload});const onImported=vi.fn(async(_parts:import("../src/domain/model").Part[],_selection:LiveOnshapeSelection)=>({state:"pending" as const,message:"Synthetic automatic cloud queue"}));
 const service=new OnshapeService({transport:createOAuthOnshapeTransport({getAccessToken:async()=> 'intentionally-not-a-real-token',fetcher}),onImported});
 try{
  const options=await service.listParts(base,undefined,false);const part=options.find(p=>p.available)!;
  const started=service.startImport({...base,partIds:[part.id],classifications:{[part.id]:'make'}});
  expect(started.progress).toMatchObject({phase:'resolving',percent:1});
  for(let i=0;i<100&&service.getImport(started.id)?.progress.phase!=='downloading';i++)await new Promise(resolve=>setTimeout(resolve,1));
  expect(service.getImport(started.id)?.progress).toMatchObject({phase:'downloading',percent:20});
  release();const finished=await terminal(service,started.id);expect(finished.state).toBe('done');expect(onImported).toHaveBeenCalledTimes(1);expect(onImported.mock.calls[0]?.[0]).toEqual(finished.parts);expect(finished.sharing).toMatchObject({state:'pending'});
  const calls=vi.mocked(fetcher).mock.calls.length;
  const second=service.startImport({...base,partIds:[part.id],classifications:{[part.id]:'make'}});
  expect((await terminal(service,second.id)).state).toBe('done');expect(vi.mocked(fetcher).mock.calls.length).toBe(calls);
 }finally{release();service.shutdown();}
});
const inchStl = mmStl.replace(
  /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g,
  (_all, x, y, z) =>
    `vertex ${Number(x) / 25.4} ${Number(y) / 25.4} ${Number(z) / 25.4}`,
);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function upstream(
  options: {
    failedExport?: boolean;
    wrongUnits?: boolean;
    linkedDenied?: boolean;
    assembly?: boolean;
    waitForDownload?: Promise<void>;
  } = {},
) {
  return vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input));
      const p = url.pathname;
      expect(url.origin).toBe("https://cad.onshape.com");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer intentionally-not-a-real-token",
      });
      if (p === "/api/v17/documents")
        return json({
          items: [
            {
              id: did,
              name: "Actual API shape · mocked upstream",
              resourceType: "document",
            },
            { id: eid, name: "Folder", isContainer: true },
          ],
          ...(url.searchParams.get("offset") === "20"
            ? {}
            : {
                next: "https://cad.onshape.com/api/v17/documents?offset=20&limit=20",
              }),
        });
      if (p.endsWith("/versions"))
        return json([{ id: vid, name: "Design freeze" }]);
      if (p.endsWith("/elements"))
        return json([
          {
            id: options.assembly ? assemblyEid : eid,
            name: options.assembly ? "Intake assembly" : "Separated parts",
            elementType: options.assembly ? "ASSEMBLY" : "PARTSTUDIO",
          },
          { id: assemblyEid, name: "Drawing", elementType: "DRAWING" },
        ]);
      if (p.endsWith("/configuration"))
        return json({
          configurationParameters: [
            {
              btType: "BTMConfigurationParameterEnum-105",
              parameterId: "side",
              parameterName: "Side",
              defaultValue: "left",
              options: [
                { option: "left", optionName: "Left" },
                { option: "right", optionName: "Right" },
              ],
            },
            {
              btType: "BTMConfigurationParameterBoolean-2550",
              parameterId: "spare",
              parameterName: "Spare",
              defaultValue: false,
            },
            {
              btType: "BTMConfigurationParameterQuantity-1826",
              parameterId: "gap",
              parameterName: "Gap",
              rangeAndDefault: { defaultValue: 0.025, units: "meter" },
            },
          ],
        });
      if (p.includes("/assemblies/"))
        return json({
          rootAssembly: {
            instances: [
              {
                id: "left",
                name: "Left module",
                type: "Assembly",
                documentId: did,
                documentVersion: vid,
                elementId: eid,
                configuration: base.configuration,
              },
              {
                id: "right",
                name: "Right module",
                type: "Assembly",
                documentId: did,
                documentVersion: vid,
                elementId: eid,
                configuration: base.configuration,
              },
              {
                id: "linked",
                name: "Linked bracket",
                type: "Part",
                documentId: linkedDid,
                documentVersion: linkedVersion,
                elementId: eid,
                partId: "LNK",
                configuration: "default",
              },
              {
                id: "suppressed",
                name: "Suppressed part",
                type: "Part",
                documentId: did,
                elementId: eid,
                partId: "SUP",
                suppressed: true,
              },
            ],
            occurrences: [
              { path: ["left", "mount"], transform: identity },
              {
                path: ["right", "mount"],
                transform: [1, 0, 0, 0.25, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              },
              { path: ["linked"], transform: identity },
              { path: ["suppressed"], transform: identity },
            ],
          },
          subAssemblies: [
            {
              documentId: did,
              documentVersion: vid,
              elementId: eid,
              configuration: base.configuration,
              instances: [
                {
                  id: "mount",
                  name: "Bracket <1>",
                  type: "Part",
                  documentId: did,
                  elementId: eid,
                  partId: "JHD",
                  configuration: base.configuration,
                },
              ],
            },
          ],
        });
      if (p.includes("/partid/") && p.endsWith("/boundingboxes")) {
        if (p.includes(linkedDid)) {
          expect(url.searchParams.get("linkDocumentId")).toBe(did);
          if (options.linkedDenied) return json({ private: "not echoed" }, 403);
        }
        return json({
          lowX: 0,
          lowY: 0,
          lowZ: 0,
          highX: 0.072,
          highY: 0.048,
          highZ: 0.008,
        });
      }
      if (p.endsWith("/stl")) {
        expect(url.searchParams.get("units")).toBe("inch");
        expect(url.searchParams.get("scale")).toBe("1");
        if (options.waitForDownload) await options.waitForDownload;
        if (options.failedExport)
          return json({ privateSignedUrl: "secret-will-not-be-echoed" }, 403);
        return new Response(options.wrongUnits ? mmStl : inchStl);
      }
      if (p.includes("/parts/"))
        return json([
          {
            partId: "JHD",
            name: "Bracket",
            bodyType: "solid",
            material: { displayName: "ABS" },
          },
          { partId: "SURFACE", name: "Reference surface", bodyType: "surface" },
        ]);
      throw new Error(`Unexpected mocked path ${p}`);
    },
  ) as unknown as typeof fetch;
}
async function withServer(
  fn: (
    client: HttpOnshapeAdapter,
    url: string,
    directory: string,
    fetcher: ReturnType<typeof upstream>,
  ) => Promise<void>,
  opts: Parameters<typeof upstream>[0] = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "foundry-onshape-"));
  const tokenFile = path.join(directory, "oauth-token");
  await writeFile(tokenFile, "intentionally-not-a-real-token", { mode: 0o600 });
  const fetcher = upstream(opts);
  const app = await createApp({
    dataDirectory: directory,
    onshape: { tokenFile, fetcher },
  });
  const server = app.listen(0, "127.0.0.1") as Server;
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    await fn(
      new HttpOnshapeAdapter(fetch, url + "/api/onshape"),
      url,
      directory,
      fetcher,
    );
  } finally {
    await app.locals.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
async function terminal(
  service: OnshapeService,
  id: string,
): Promise<OnshapeImportJob> {
  for (let i = 0; i < 100; i++) {
    const job = service.getImport(id)!;
    if (!["queued", "running"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Import did not finish");
}

describe("configured live HTTP intake with mocked Onshape upstream, not an account connection", () => {
  it('discovers a whole assembly without one bounding-box request per part and recounts a subsystem exactly',async()=>withServer(async(client,_url,_directory,fetcher)=>{const source={...base,elementType:'assembly' as const,elementId:assemblyEid};const parts=await client.listRobotParts(source);expect(parts.find(p=>p.partId==='JHD')).toMatchObject({quantity:2});expect(vi.mocked(fetcher).mock.calls.some(call=>String(call[0]).includes('boundingboxes'))).toBe(false);const scoped=await client.listRobotParts({...source,assemblyScope:['left']});expect(scoped.find(p=>p.partId==='JHD')).toMatchObject({quantity:1,occurrences:[{path:['left','mount']}]});expect(vi.mocked(fetcher).mock.calls.some(call=>String(call[0]).includes('boundingboxes'))).toBe(false);},{assembly:true}));
  it("browses real API response shapes, pagination, immutable versions, supported elements and config controls", async () =>
    withServer(async (client) => {
      expect(await client.capability()).toMatchObject({
        available: true,
        verified: false,
        mode: "configured",
      });
      expect(await client.listDocuments("robot")).toEqual({
        items: [{ id: did, name: "Actual API shape · mocked upstream" }],
        nextOffset: 20,
      });
      expect(await client.listDocuments("robot", 20)).not.toHaveProperty(
        "nextOffset",
      );
      expect(await client.capability()).toMatchObject({ verified: true });
      expect((await client.listVersions(did)).items).toEqual([
        { id: vid, name: "Design freeze" },
      ]);
      expect(await client.listElements(did, vid)).toEqual([
        { id: eid, name: "Separated parts", type: "partstudio" },
      ]);
      expect(await client.getConfigurations(did, vid, eid)).toMatchObject({
        defaultConfiguration: "default",
        parameters: [
          {
            id: "side",
            type: "enum",
            defaultValue: "left",
            options: [
              { id: "left", name: "Left" },
              { id: "right", name: "Right" },
            ],
          },
          { id: "spare", type: "boolean", defaultValue: "false" },
          { id: "gap", type: "quantity", defaultValue: "0.025 meter" },
        ],
      });
    }));
  it("transfers actual STL bytes behind the scenes, converts inches and retains exact immutable provenance, spares and persisted geometry", async () =>
    withServer(async (client, _url, _dir, fetcher) => {
      const options = await client.listParts(base);
      expect(options[0]).toMatchObject({
        classification: "review",
        dimensions: [72, 48, 8],
        materialHint: "CAD: ABS",
      });
      expect(options[1]).toMatchObject({ available: false });
      const progress: string[] = [];
      const selection = {
        ...base,
        partIds: [options[0].id],
        classifications: { [options[0].id]: "make" as const },
        spares: { [options[0].id]: 2 },
      };
      const parts = await client.importParts(selection, {
        pollIntervalMs: 1,
        onProgress: (p) => progress.push(p.phase),
      });
      expect(parts[0]).toMatchObject({
        quantity: 1,
        spareQuantity: 2,
        classification: "make",
        geometry: {
          dimensions: [
            expect.closeTo(72, 10),
            expect.closeTo(48, 10),
            expect.closeTo(8, 10),
          ],
          units: "mm",
          original: { units: "in" },
        },
        source: {
          kind: "onshape",
          documentId: did,
          versionId: vid,
          configuration: base.configuration,
          originVersionId: vid,
          originElementId: eid,
          originConfiguration: base.configuration,
        },
      });
      expect(progress).toContain("done");
      const before = (fetcher as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([url]) => String(url).includes("/stl?"),
      ).length;
      const again = await client.importParts(selection, { pollIntervalMs: 1 });
      expect(again[0].geometry.hash).toBe(parts[0].geometry.hash);
      expect(
        (fetcher as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
          String(url).includes("/stl?"),
        ),
      ).toHaveLength(before);
      const project = createProject();
      project.parts = parts;
      project.jobs = [createJob(parts)];
      project.activeJobId = project.jobs[0].id;
      expect(
        (await deserializeProject(serializeProject(project))).parts[0].source
          .originConfiguration,
      ).toBe(base.configuration);
    }));
  it("counts nested repeated assembly occurrences, excludes suppressed instances and keeps linked permissions visible", async () =>
    withServer(
      async (client) => {
        const parts = await client.listParts({
          ...base,
          elementType: "assembly",
          elementId: assemblyEid,
        });
        const bracket = parts.find((p) => p.partId === "JHD")!;
        expect(bracket.quantity).toBe(2);
        expect(bracket.occurrences.map((p) => p.path)).toEqual([
          ["left", "mount"],
          ["right", "mount"],
        ]);
        expect(bracket.occurrences[1].transform[3]).toBe(0.25);
        expect(bracket.assemblyMemberships).toEqual([{path:['left'],names:['Left module'],quantity:1},{path:['right'],names:['Right module'],quantity:1}]);
        const selection={...base,elementType:'assembly' as const,elementId:assemblyEid,assemblyScope:['left']};
        const scoped=await client.listParts(selection),leaf=scoped.find(p=>p.partId==='JHD')!;
        expect(leaf).toMatchObject({quantity:1,occurrences:[{path:['left','mount']}]});
        const imported=await client.importParts({...selection,partIds:[leaf.id],classifications:{[leaf.id]:'make'}},{pollIntervalMs:1});
        expect(imported[0]).toMatchObject({quantity:1,source:{assemblyScope:['left'],assemblyMemberships:[{path:['left'],names:['Left module'],quantity:1}]}});
        expect((await deserializeProject(serializeProject({...createProject('Scoped'),parts:imported}))).parts[0].source.assemblyScope).toEqual(['left']);
        await expect(client.listParts({...selection,assemblyScope:['missing']})).rejects.toThrow(/subsystem/);

        expect(parts.some((p) => p.partId === "SUP")).toBe(false);
        expect(parts.find((p) => p.partId === "LNK")).toMatchObject({
          available: false,
          unavailableReason: expect.stringMatching(/Access denied/),
        });
      },
      { assembly: true, linkedDenied: true },
    ));
  it("imports linked versioned parts through the origin document without confusing root and child versions", async () =>
    withServer(
      async (client) => {
        const selection = {
          ...base,
          elementType: "assembly" as const,
          elementId: assemblyEid,
        };
        const options = await client.listParts(selection);
        const linked = options.find((p) => p.partId === "LNK")!;
        const parts = await client.importParts(
          {
            ...selection,
            partIds: [linked.id],
            classifications: { [linked.id]: "make" },
          },
          { pollIntervalMs: 1 },
        );
        expect(parts[0].source).toMatchObject({
          documentId: linkedDid,
          versionId: linkedVersion,
          originDocumentId: did,
          originVersionId: vid,
          originElementId: assemblyEid,
          originConfiguration: base.configuration,
          installedTransformUnits: "m",
        });
        expect(parts[0].source.url).toContain(
          `/documents/${linkedDid}/v/${linkedVersion}/`,
        );
      },
      { assembly: true },
    ));
  it("rejects wrong export units without silently rescaling or accepting a partial batch", async () =>
    withServer(
      async (client) => {
        const [part] = await client.listParts(base);
        await expect(
          client.importParts(
            {
              ...base,
              partIds: [part.id],
              classifications: { [part.id]: "make" },
            },
            { pollIntervalMs: 1 },
          ),
        ).rejects.toMatchObject({ code: "UNIT_MISMATCH" });
      },
      { wrongUnits: true },
    ));
  it("reports revoked export permissions without echoing account metadata or signed URLs", async () =>
    withServer(
      async (client) => {
        const [part] = await client.listParts(base);
        await expect(
          client.importParts(
            {
              ...base,
              partIds: [part.id],
              classifications: { [part.id]: "make" },
            },
            { pollIntervalMs: 1 },
          ),
        ).rejects.toThrow(/Access denied/);
        expect(await client.capability()).toMatchObject({ verified: false });
      },
      { failedExport: true },
    ));
  it("rejects arbitrary fields, invalid identifiers/config/spares, unknown parts and duplicate selections", async () =>
    withServer(async (client, url) => {
      const post = (body: unknown) =>
        fetch(url + "/api/onshape/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      for (const body of [
        { ...base, upstreamUrl: "https://other.example" },
        { ...base, versionId: "workspace" },
        { ...base, configuration: "" },
        { ...base, spares: { x: 1.5 } },
      ])
        expect((await post(body)).status).toBe(400);
      const [part] = await client.listParts(base);
      await expect(
        client.importParts(
          { ...base, partIds: [part.id, part.id] },
          { pollIntervalMs: 1 },
        ),
      ).rejects.toMatchObject({ code: "DUPLICATE_SELECTION" });
      await expect(
        client.importParts(
          { ...base, partIds: ["missing"] },
          { pollIntervalMs: 1 },
        ),
      ).rejects.toMatchObject({ code: "UNKNOWN_PART" });
      await expect(
        client.listParts({ ...base, elementType: "assembly" }),
      ).rejects.toThrow(/Choose an available assembly or Part Studio/);
    }));
  it("accepts explicit make/buy decisions while defaulting real CAD to review", async () =>
    withServer(async (client) => {
      const [part] = await client.listParts(base);
      await expect(
        client.importParts(
          {
            ...base,
            partIds: [part.id],
            classifications: { [part.id]: "buy" },
          },
          { pollIntervalMs: 1 },
        ),
      ).rejects.toMatchObject({ code: "NO_MANUFACTURED_PARTS" });
      const reviewed = await client.importParts(
        { ...base, partIds: [part.id] },
        { pollIntervalMs: 1 },
      );
      expect(reviewed[0].classification).toBe("review");
    }));
  it("cancels after job creation, drops late geometry, and makes duplicate cancellation idempotent", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transport = createOAuthOnshapeTransport({
      getAccessToken: async () => "intentionally-not-a-real-token",
      fetcher: upstream({ waitForDownload: gate }),
    });
    const service = new OnshapeService({ transport });
    const [part] = await service.listParts(base);
    const created = service.startImport({ ...base, partIds: [part.id] });
    expect(service.cancelImport(created.id).state).toBe("cancelled");
    expect(service.cancelImport(created.id).state).toBe("cancelled");
    finish();
    const result = await terminal(service, created.id);
    expect(result).not.toHaveProperty("parts");
    expect(result.state).toBe("cancelled");
    service.shutdown();
  });
  it("limits active imports and treats interrupted/missing job polling as actionable recovery", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = new OnshapeService({
      transport: {
        request: async () => {
          await gate;
          return [] as never;
        },
      },
    });
    service.startImport(base);
    service.startImport(base);
    expect(() => service.startImport(base)).toThrow(/Two geometry transfers/);
    expect(() => service.cancelImport("lost-after-restart")).toThrow(
      /interrupted server transfer/,
    );
    expect(service.getImport("lost-after-restart")).toBeUndefined();
    service.shutdown();
    finish();
  });
});

describe("credential and transport failure boundaries", () => {
  it("stays unavailable without configured credentials or when the token file is unreadable", async () => {
    const service = new OnshapeService();
    expect(await service.capability()).toMatchObject({
      available: false,
      verified: false,
    });
    await expect(service.listDocuments()).rejects.toMatchObject({
      status: 503,
    });
    expect(
      await new OnshapeService({
        tokenFile: "/not-a-configured-token-file",
      }).capability(),
    ).toMatchObject({ available: false, verified: false });
  });
  it("has actionable expired login and never echoes upstream response bodies", async () => {
    const service = new OnshapeService({
      transport: createOAuthOnshapeTransport({
        getAccessToken: async () => "not-real",
        fetcher: async () => json({ secret: "do-not-return" }, 401),
      }),
    });
    await expect(service.listDocuments()).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/Authorisation expired/),
    });
    expect(await service.capability()).toMatchObject({ verified: false });
  });
  it("retries only GET rate-limit failures and does not duplicate translation POSTs", async () => {
    const fetcher = vi.fn(async () => json({}, 429));
    const transport = createOAuthOnshapeTransport({
      getAccessToken: async () => "not-real",
      fetcher,
      retryDelayMs: 0,
    });
    await expect(
      transport.request("GET", "/api/v17/documents"),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear();
    await expect(
      transport.request(
        "POST",
        "/api/v17/partstudios/d/x/v/y/e/z/translations",
        { body: {} },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds network timeouts, sanitizes network failures and rejects oversized responses", async () => {
    const waiting = createOAuthOnshapeTransport({
      getAccessToken: async () => "not-real",
      timeoutMs: 5,
      fetcher: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true },
          );
        }),
    });
    await expect(
      waiting.request("GET", "/api/v17/documents"),
    ).rejects.toMatchObject({ status: 504 });
    const broken = createOAuthOnshapeTransport({
      getAccessToken: async () => "not-real",
      fetcher: async () => {
        throw new Error("private-signed-url");
      },
    });
    await expect(
      broken.request("GET", "/api/v17/documents"),
    ).rejects.toMatchObject({
      message:
        "The server could not reach Onshape. Check network access and retry.",
    });
    const large = createOAuthOnshapeTransport({
      getAccessToken: async () => "not-real",
      fetcher: async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1)),
    });
    await expect(
      large.request("GET", "/api/v17/part/stl", { binary: true }),
    ).rejects.toMatchObject({ status: 413 });
  });
});

it("binds the selected root assembly context into hashes and invalidates approval when it changes", async () => {
  const service = new OnshapeService({
    transport: createOAuthOnshapeTransport({
      getAccessToken: async () => "intentionally-not-a-real-token",
      fetcher: upstream(),
    }),
  });
  const [option] = await service.listParts(base);
  const started = service.startImport({
    ...base,
    partIds: [option.id],
    classifications: { [option.id]: "make" },
  });
  const completed = await terminal(service, started.id);
  const project = createProject();
  project.parts = completed.parts!;
  project.jobs = [createJob(project.parts)];
  project.activeJobId = project.jobs[0].id;
  const job = project.jobs[0];
  job.items[0].position = [60, 60, 0];
  job.printer.tested = true;
  job.material.tested = true;
  await attachToolpath(
    project,
    job,
    "G21\nG90\nM83\nG0 X50 Y50 Z0.2\n;TYPE:Outer wall\nG1 X60 Y50 E1\nG1 X60 Y60 E1\n",
    {
      name: "reviewed.gcode",
      source: "imported",
      mappingConfirmed: true,
      slicer: { id: "external", version: "1" },
    },
  );
  await reviewToolpath(project, job, "Operator");
  await approveJob(project, job, "Operator");
  expect(await isApprovalCurrent(project, job)).toBe(true);
  for (const field of [
    "originVersionId",
    "originElementId",
    "originConfiguration",
  ] as const) {
    const copy = structuredClone(project);
    const before = await fingerprint(copy, copy.jobs[0]);
    copy.parts[0].source[field] += "-changed";
    expect(await fingerprint(copy, copy.jobs[0])).not.toBe(before);
    expect(await isApprovalCurrent(copy, copy.jobs[0])).toBe(false);
    invalidateChangedJobs(project, copy, "source context changed");
    expect(copy.jobs[0].approval).toBeUndefined();
    expect(copy.jobs[0].toolpath?.stale).toBe(true);
  }
  service.shutdown();
});

it("runs configured asynchronous STL capability, translation polling and declared-unit validation without a live account", async () => {
  let polls = 0;
  const regular = upstream();
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const p = url.pathname;
    if (p.endsWith("/translations/translationformats"))
      return json([{ name: "STL", validDestinationFormat: true }]);
    if (options?.method === "POST" && p.endsWith("/translations")) {
      expect(JSON.parse(String(options.body))).toMatchObject({
        formatName: "STL",
        unit: "millimeter",
        configuration: base.configuration,
        partIds: "JHD",
        storeInDocument: false,
        grouping: true,
      });
      return json({ id: "translation-a", requestState: "ACTIVE" });
    }
    if (p.endsWith("/translations/translation-a")) {
      polls++;
      return json({
        id: "translation-a",
        requestState: "DONE",
        resultExternalDataIds: ["download-a"],
        resultDocumentId: did,
      });
    }
    if (p.endsWith("/externaldata/download-a")) return new Response(mmStl);
    return regular(input, options);
  };
  const service = new OnshapeService({
    transport: createOAuthOnshapeTransport({
      getAccessToken: async () => "intentionally-not-a-real-token",
      fetcher,
    }),
    exportMode: "async-stl",
    asyncUnit: "millimeter",
    asyncOutputUnits: "mm",
    pollIntervalMs: 0,
  });
  const [part] = await service.listParts(base);
  const started = service.startImport({ ...base, partIds: [part.id] });
  const done = await terminal(service, started.id);
  expect(done.state).toBe("done");
  expect(polls).toBe(1);
  expect(done.parts?.[0].geometry.dimensions).toEqual([72, 48, 8]);
  expect(done.parts?.[0].geometry.original?.units).toBe("mm");
  service.shutdown();
});
it("fails incomplete async unit configuration explicitly instead of guessing the translator unit", async () => {
  const service = new OnshapeService({
    transport: createOAuthOnshapeTransport({
      getAccessToken: async () => "intentionally-not-a-real-token",
      fetcher: upstream(),
    }),
    exportMode: "async-stl",
  });
  const [part] = await service.listParts(base);
  const started = service.startImport({ ...base, partIds: [part.id] });
  const done = await terminal(service, started.id);
  expect(done).toMatchObject({ state: "failed", code: "UNITS_REQUIRED" });
  expect(done.parts).toBeUndefined();
  service.shutdown();
});

it("binds the default browser fetch receiver instead of invoking Window.fetch as a class method", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(function (
    this: typeof globalThis,
  ) {
    expect(this).toBe(globalThis);
    return Promise.resolve(
      json({ available: false, mode: "disconnected", verified: false }),
    );
  });
  try {
    expect(await new HttpOnshapeAdapter().capability()).toMatchObject({
      available: false,
    });
    expect(spy).toHaveBeenCalledOnce();
  } finally {
    spy.mockRestore();
  }
});

