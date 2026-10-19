# Onshape: real intake adapter, explicit setup and validation boundary

Public documentation and the current public OpenAPI were checked on **2026-10-17 (Pacific time)**. Schema `1.222.90730-c8d74e607a47` still advertises `https://cad.onshape.com/api/v17`. No private document, account or credential was used. The public OpenAPI request is the only genuine Onshape service access demonstrated in this environment; all authenticated API tests use explicitly mocked upstream responses.

## What is implemented

The guided intake offers **Live Onshape**, **Demonstration fixtures** and **Local STL** as separate paths. Live comes first and stays visibly unavailable without server configuration. Configured means a server credential provider exists; it does not mean authentication succeeded. `verified` changes only after the upstream accepts a documented request, and a 401/403 clears it. Each document/linked part/export still needs its own permission.

When an operator supplies authorised server-side OAuth access, the actual HTTP path is:

1. Search documents with pagination, or parse a strict `https://cad.onshape.com/documents/...` link. Browser links become identifiers; the server never fetches arbitrary pasted URLs.
2. Explicitly choose a named immutable version, assembly or Part Studio, configuration, parts and spares. Workspace/microversion links require a named version selection. The server checks the real element type.
3. List the actual configured CAD parts and CAD bounding-box dimensions. Assembly occurrence paths, absolute installed transforms and repeated/nested quantities are preserved. Suppressed occurrences are excluded. Hidden active parts are not silently excluded.
4. Classify intended parts as make/buy/review. Real CAD defaults to **review**. Purchased exclusions are explicit. CAD material is only a hint. Unsupported surface/mesh items and inaccessible linked parts stay unavailable with a reason.
5. Transfer the selected separate parts directly from Onshape, validate explicit units and CAD dimensions, retain original STL bytes and normalized-mm geometry, hash the exact artifacts, and accept the whole batch atomically.

The live service uses a real server-owned transport and real routes. It is ready for operator configuration and authorised qualification; it has **not been qualified against the team's account or CAD**. Fixture imports remain demonstration data and do not establish production readiness.

Implementation:

- `src/adapters/onshape.ts`: strict link parser, immutable API operations, occurrence resolution, fixture transfer and revision comparison.
- `src/adapters/onshape-http.ts`: browser-safe HTTP catalog/import client, polling and cancellation; no credentials.
- `server/onshape.ts`: server OAuth transport, bounded 45-second requests, GET-only retries for 429/502/503/504, bounded downloads and reviewed redirect handling. Upstream error bodies and network URLs are not echoed to the browser.
- `server/onshape-service.ts`: response-to-domain mapping, actual CAD dimension checks, atomic background transfers, exact immutable cache, progress, cancellation and precise source context.
- `server/onshape-http.ts`: narrow validated API routes; no client-supplied upstream host, token, artifact host or filesystem path.

## Login and configuration required

There is **no in-app OAuth login, refresh-token store or multi-user authentication** in this local single-operator version. Do not expose it as a team-hosted Internet service. The shipped runtime has no configured Onshape account.

An authorised administrator must use an existing approved Onshape OAuth application and its external authorisation/token flow to obtain an OAuth access token. If the team has no application, registration, callback URI, authorisation-code exchange, state/CSRF validation and secure token custody must be arranged by the administrator before live access can work. This build does not register an application, generate credentials or ask for secrets in chat.

1. Use the correct Onshape deployment and approved application. Grant the documented `OAuth2Read` scope for catalog/geometry access. Selected documents must permit exports. Linked documents must be shared or accessible through the origin document. Ordinary passwords and private browser cookies are unsupported.
2. Have the existing authorised token workflow place **only the short-lived access token** in a UTF-8 file owned by the local server operator. Keep it outside the repository and application bundle. Do not place a JSON token response or refresh token in this file. Foundry never returns its contents to the browser.
3. Point the server to that existing file and restart Foundry:

   ```powershell
   $env:ONSHAPE_ACCESS_TOKEN_FILE = 'C:\Foundry-private\onshape-access-token.txt'
   npm run dev
   ```

   This command selects a file; it does not perform login or create its contents. Windows installation/launch instructions are in `docs/WINDOWS.md` when available. For programmatic token stores, inject `OnshapeServiceOptions.transport` built with `createOAuthOnshapeTransport({ getAccessToken })`; the callback may refresh an existing authorised token in the team's own store. No token is bundled into client code.

4. Open **Live Onshape** and search/open a document. A configured but expired token produces an actionable 401. Re-authorise through the approved external OAuth flow and replace the token file; it is read for each request, so the server need not store a refresh token. A 403 requires document/export/linked-document permission review.
5. Import a small known-dimension part, compare dimensions to Onshape, then run the authorised qualification checklist below before physical manufacturing. Configuring access alone does not validate print settings, material, machine or toolpaths.

On this cloud's proxy network, Node must use the inherited proxy and CA trust. Verified public request command:

```bash
node --use-env-proxy -e "fetch('https://cad.onshape.com/api/openapi').then(r=>console.log(r.status))"
```

This returned HTTP 200 on Node 24.19.0; ordinary Node `fetch` without the proxy flag failed `ECONNREFUSED`. Preserve `HTTP_PROXY`/`HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`; never bypass or disable trust checks. Launch the cloud server with `node --use-env-proxy --import tsx server/index.ts` if the launcher has not already opted into Node's environment proxy support. A normal Windows network may not require a proxy. The token itself was never supplied during these public checks.

### Export modes

**Default: `sync-stl`**. Each separate part uses the documented per-part STL endpoint with `mode=text&units=inch&scale=1`. The adapter deliberately converts inches to mm and validates the mesh against CAD bounding-box extents in native SI metres converted explicitly to mm. It never infers units from size, silently rescales a mismatch, repairs geometry, splits fused solids or merges lookalike parts. A 25.4× discrepancy fails as `UNIT_MISMATCH`.

The local server still runs sync exports as asynchronous background **intake jobs**, with progress, polling, cancellation and atomic batch acceptance. These local jobs are distinct from Onshape's asynchronous translation API.

**Optional: `async-stl`** uses the documented translation API, not a fake timer. Enable only after the deployment's accepted export-unit value is qualified:

```powershell
$env:ONSHAPE_EXPORT_MODE = 'async-stl'
$env:ONSHAPE_ASYNC_STL_UNIT = '<unit string verified for your Onshape translator>'
$env:ONSHAPE_ASYNC_OUTPUT_UNITS = 'mm' # or 'in'; must match actual output
```

No unit string is assumed. Both settings are required, the actual advertised destination STL format is checked, and the final mesh must match expected CAD dimensions. The test value `millimeter` is an **injected mock value**, not a claimed live qualification. Translation `ACTIVE`/`DONE`/`FAILED`, polling, timeout, single external-result download and best-effort DELETE cancellation are implemented and tested. Only one STL result is accepted; multi-file archives require a future explicit file-to-part mapping.

For an external download redirect, inspect the real trusted host before adding it to comma-separated `ONSHAPE_ARTIFACT_HOSTS`. Client input can never add hosts. Only binary geometry GETs may leave `cad.onshape.com`, authorization is stripped off-origin, HTTPS remains mandatory, and redirects are bounded. Do not whitelist broad wildcard hosts. Remote translation DELETE may need `OAuth2Write`; use that scope only if the administrator deliberately authorises it. Local cancellation still discards results when remote deletion is denied and does not claim Onshape compute stopped.

## Supported documented operations

Paths are relative to `/api/v17`:

| Purpose | Operation |
| --- | --- |
| Search documents | `GET /documents?q=…&offset=…&limit=20` |
| Named immutable versions | `GET /documents/d/{did}/versions?offset=…&limit=20` |
| Version elements | `GET /documents/d/{did}/v/{vid}/elements` |
| Configuration definitions | `GET /elements/d/{did}/v/{vid}/e/{eid}/configuration` |
| Assembly definition | `GET /assemblies/d/{did}/v/{vid}/e/{eid}?configuration=…&excludeSuppressed=false&includeNonSolids=false` |
| Separate Part Studio parts | `GET /parts/d/{did}/v/{vid}/e/{eid}?configuration=…&withThumbnails=true` |
| Per-part CAD bounding box | `GET /parts/d/{did}/v/{vid}/e/{eid}/partid/{partid}/boundingboxes?configuration=…&includeHidden=true` |
| Direct per-part STL | `GET /parts/d/{did}/v/{vid}/e/{eid}/partid/{partid}/stl?mode=text&units=inch&scale=1&configuration=…` |
| Translator capabilities | `GET /translations/translationformats` |
| Start optional translation | `POST /partstudios/d/{did}/v/{vid}/e/{eid}/translations` |
| Poll / cancel translation | `GET` / `DELETE /translations/{tid}` |
| Completed external result | `GET /documents/d/{did}/externaldata/{fid}` |

Linked-part reads use the actual child document/version/Part Studio/configuration plus the selected origin `linkDocumentId`, never an invented current workspace. A linked source with only a microversion and no named child version is visibly unavailable in this bounded version: pin it to an accessible named version in Onshape. Missing nested definitions fail clearly instead of silently removing quantities.

All source fields participate in the manufacturing hash: child document/version/configuration/part, exact selected origin document/version/element/configuration, occurrence paths and installed transforms. Source installed transforms are row-major, absolute and in metres; parent matrices are not multiplied again. Manufacturing orientation remains a separate mm/degree job input.

Live configuration controls support the documented enum/boolean/quantity/string definitions, with raw `parameterId=value` entries joined by `;` and the entire request string URL-encoded once. A pasted exact configuration remains useful. Complex encoded configurations and free-form values containing embedded separators require review; no unknown value is guessed. Current local persisted-source constraints cap a configuration string at 1,500 characters.

## Bounds, interruption and remaining work

- Two live transfers may run concurrently. Each part is limited to 20 MiB and 250,000 triangles. A complete intake batch is limited to 24 MiB of normalized/original text; large batches fail atomically with recovery guidance.
- The immutable geometry cache is process-local, bounded to 30 entries/32 MiB, keyed by source document/version/element/part/configuration and export mode/units. It does not reuse current-workspace geometry for an old job. Accepted projects retain their own original and normalized artifacts.
- Import progress/results are transient and bounded. An interrupted server transfer is retried explicitly; the next server cannot recover a live Onshape transaction from the old process. A cached completed source can avoid re-export on retry in the same process. No partially accepted batch is returned.
- Request timeout is 45 seconds; retries are bounded, apply only to GETs and respect a capped Retry-After delay. Translation POSTs are never automatically duplicated.
- Source names and quantities are retained. CAD thumbnails are not downloaded; genuine generated geometry thumbnails are shown after intake. Local fallback is genuine ASCII/binary STL with declared mm/in, invalid/oversize checks, original-byte retention and no repair. STEP/OBJ/3MF local intake is deferred.
- Fixture V19 comparison is implemented; automatic live revision monitoring and live change-review UI are deferred. Re-import a deliberately selected new version into a separate job and compare before replacement. Existing approved geometry is never silently refreshed.
- OAuth login/callback/refresh-token custody, multi-user account/project isolation, complex configuration encoding, microversion-only linked export and durable background intake recovery remain unimplemented. They are not simulated as connected features.

## Exact tests and evidence boundary

```bash
npx vitest run tests/onshape.test.ts tests/onshape-http.test.ts tests/server.test.ts
```

Latest focused run: **37 tests passed in 3 files**, 3.37 s. This includes 18 new real-local-HTTP/server/client tests with mocked Onshape upstream: response mapping, pagination, immutable selection, configurations including explicit quantity-default units, real STL transfer and inch→mm validation, original/hash persistence, cached exact source, repeated/nested/suppressed instances, linked permissions and distinct child/root versions, wrong units, 401/403/rate-limit/timeout/oversize failures, explicit classifications, duplicate selections, unknown/invalid imports, cancellation, interrupted jobs and origin-context approval invalidation. Optional async translation/unit configuration is exercised with mocked upstream states. Existing fixture and OAuth-redirect tests remain.

Genuinely run: public documentation/OpenAPI retrieval, genuine local HTTP routes, STL parsing/hashing/conversion/persistence, mocked credential-file transport, and process-local cancellation/failure behavior. **Not run:** authenticated Onshape account access or a live team's document/export. Browser configured-service tests use explicit API mocks; they are not evidence of a real login.

Before team use, run authorised live tests for document/version pagination, configuration controls and encoding, actual nested/patterned quantities against the Onshape BOM, suppressed/hidden behavior, linked access/revocation and named versions, units/dimensions against a known CAD part, redirects, optional async accepted units/archive behavior, 429/5xx/expiry/cancel and interrupted recovery. Validate a real newer revision in a separate job before any replacement. An administrator must also qualify secure access if moving beyond one local operator.

## Simulation and future formats

Primary references: [assemblies](https://onshape-public.github.io/docs/api-adv/assemblies/), [translation](https://onshape-public.github.io/docs/api-adv/translation/), [configurations](https://onshape-public.github.io/docs/api-adv/configs/), [authentication](https://onshape-public.github.io/docs/auth/), [OpenAPI](https://cad.onshape.com/api/openapi), [Simulation help](https://cad.onshape.com/help/Content/Assembly/simulation.htm).

The public schema did not expose numerical Simulation-result endpoints. Simulation help does not establish a numerical API. Store reviewed study links and user-confirmed loads/constraints/operating conditions manually; missing values remain missing. Geometry heuristics and a stress-magnitude image are not FEA, anisotropic printed-layer validation, safety factors or strength guarantees. Numerical automation remains deferred pending a documented supported API or reviewed numerical export. Geometry-only 3MF never supplies Bambu printer/filament/process settings; actual slicing needs independently configured complete profiles.
