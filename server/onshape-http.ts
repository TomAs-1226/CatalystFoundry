import type { Express } from "express";
import { z } from "zod";
import { OnshapeService } from "./onshape-service";
const cadId = z
  .string()
  .regex(
    /^[a-f\d]{24}$/i,
    "Select a valid Onshape document, immutable version and element identifier.",
  )
  .transform((value) => value.toLowerCase());
const offset = z.coerce.number().int().min(0).max(100_000).default(0);
const selection = z
  .object({
    documentId: cadId,
    versionId: cadId,
    elementId: cadId,
    elementType: z.enum(["assembly", "partstudio"]),
    configuration: z.string().min(1).max(1500),
    partIds: z.array(z.string().min(1).max(8192)).max(100).optional(),
    spares: z
      .record(z.string().max(8192), z.number().int().min(0).max(999))
      .optional(),
    classifications: z
      .record(z.string().max(8192), z.enum(["make", "buy", "review"]))
      .optional(),
    excludePurchased: z.boolean().optional(),
    assemblyScope:z.array(z.string().min(1).max(2000)).max(100).optional(),
    library:z.object({label:z.string().trim().min(1).max(100),workOrder:z.string().trim().min(1).max(100)}).strict().optional(),
  })
  .strict();

/** Narrow identifiers only. Browser callers cannot select a token, arbitrary upstream URL, artifact host or server file. */
export function registerOnshapeRoutes(app: Express, service: OnshapeService) {
  app.get("/api/onshape/capability", async (_req, res, next) => {
    try {
      res.json(await service.capability());
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/onshape/documents", async (req, res, next) => {
    try {
      res.json(
        await service.listDocuments(
          z
            .string()
            .max(200)
            .parse(req.query.q ?? ""),
          offset.parse(req.query.offset),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/onshape/documents/:did/versions", async (req, res, next) => {
    try {
      res.json(
        await service.listVersions(
          cadId.parse(req.params.did),
          offset.parse(req.query.offset),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/api/onshape/documents/:did/versions/:vid/elements",
    async (req, res, next) => {
      try {
        res.json(
          await service.listElements(
            cadId.parse(req.params.did),
            cadId.parse(req.params.vid),
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/onshape/documents/:did/versions/:vid/elements/:eid/configurations",
    async (req, res, next) => {
      try {
        res.json(
          await service.getConfigurations(
            cadId.parse(req.params.did),
            cadId.parse(req.params.vid),
            cadId.parse(req.params.eid),
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.post("/api/onshape/parts", async (req, res, next) => {
    try {
      res.json({ parts: await service.listParts(selection.parse(req.body)) });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/onshape/robot/parts',async(req,res,next)=>{try{res.json({parts:await service.listParts(selection.parse(req.body),undefined,false)});}catch(error){next(error);}});
  app.post("/api/onshape/imports", (req, res, next) => {
    try {
      res.status(202).json(service.startImport(selection.parse(req.body)));
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/onshape/imports/:id", (req, res) => {
    const job = service.getImport(req.params.id);
    if (!job) {
      res
        .status(404)
        .json({
          error:
            "Geometry transfer not found. An interrupted server transfer must be started again.",
          code: "IMPORT_NOT_FOUND",
        });
      return;
    }
    res.json(job);
  });
  app.post("/api/onshape/imports/:id/cancel", (req, res, next) => {
    try {
      res.json(service.cancelImport(req.params.id));
    } catch (e) {
      next(e);
    }
  });
}
