import type { OnshapeTransport } from "../src/adapters/onshape";

export interface OnshapeServerTransportOptions {
  /** Obtain an existing short-lived OAuth2 token from a server-owned, authorised store. Never a browser secret. */
  getAccessToken: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  /** Only independently reviewed hosts may receive geometry redirects. Bearer tokens are never forwarded there. */
  artifactHosts?: string[];
  timeoutMs?: number;
  /** GET retries only: translation POSTs are never automatically duplicated. */
  retryDelayMs?: number;
}
export class OnshapeHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "OnshapeHttpError";
  }
}
const reason = (status: number) =>
  status === 401
    ? "Authorisation expired. Re-authorise Onshape outside Foundry and replace the server-owned OAuth token file."
    : status === 402
      ? "Onshape API allocation is exhausted. Saved Foundry projects still slice offline."
    : status === 403
      ? "Access denied. Check document export rights, sharing and linked-document permissions."
      : status === 404
        ? "The selected immutable version, element or linked part is unavailable."
        : status === 429
          ? "Onshape rate limit reached after bounded retries. Wait before retrying the transfer."
          : status >= 500
            ? "Onshape is temporarily unavailable. Retry later; no geometry was accepted."
            : `Onshape returned HTTP ${status}. Review the selected document and export settings.`;
/** Concrete server-only OAuth transport. Configuration is explicit and never claims login or token refresh. */
export function createOAuthOnshapeTransport(
  options: OnshapeServerTransportOptions,
): OnshapeTransport {
  const fetcher = options.fetcher ?? fetch;
  return {
    async request<T>(
      method: "GET" | "POST" | "DELETE",
      path: string,
      requestOptions?: {
        body?: unknown;
        signal?: AbortSignal;
        binary?: boolean;
      },
    ) {
      if (
        !/^\/api\/v\d+\//.test(path) ||
        path.includes("\\") ||
        /[\r\n]/.test(path) ||
        /(?:^|\/)\.{1,2}(?:\/|$)/.test(path.split("?")[0])
      )
        throw new Error(
          "Only relative documented Onshape API paths are accepted.",
        );
      const token = await options.getAccessToken();
      if (!token)
        throw new OnshapeHttpError(
          503,
          "Authorised Onshape access is unavailable. Configure a server-owned OAuth token provider.",
        );
      const origin = "https://cad.onshape.com";
      let url = new URL(path, origin);
      let nextMethod = method;
      const serialized =
        requestOptions?.body === undefined
          ? undefined
          : JSON.stringify(requestOptions.body);
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 45_000);
      const signal = requestOptions?.signal
        ? AbortSignal.any([requestOptions.signal, timeout])
        : timeout;
      const wait = async (ms: number) => {
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", cancel);
            resolve();
          }, ms);
          const cancel = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", cancel);
            reject(signal.reason);
          };
          signal.addEventListener("abort", cancel, { once: true });
        });
      };
      try {
        for (let redirect = 0; redirect <= 4; redirect++) {
          const isOnshape = url.origin === origin;
          const headers: Record<string, string> = {
            Accept: requestOptions?.binary
              ? "application/octet-stream"
              : "application/json",
          };
          if (isOnshape) headers.Authorization = `Bearer ${token}`;
          if (serialized && nextMethod !== "GET")
            headers["Content-Type"] = "application/json";
          let response: Response | undefined;
          for (let attempt = 0; attempt <= 2; attempt++) {
            response = await fetcher(url, {
              method: nextMethod,
              headers,
              body: nextMethod === "GET" ? undefined : serialized,
              signal,
              redirect: "manual",
            });
            if (
              nextMethod !== "GET" ||
              ![429, 502, 503, 504].includes(response.status) ||
              attempt === 2
            )
              break;
            const retryAfter = Number(response.headers.get("retry-after"));
            const backoff =
              options.retryDelayMs !== undefined
                ? options.retryDelayMs
                : Math.min(
                    5000,
                    Math.max(
                      500 * 2 ** attempt,
                      Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
                    ),
                  );
            await response.body?.cancel();
            await wait(backoff);
          }
          if (!response)
            throw new OnshapeHttpError(
              502,
              "Onshape returned no response. Retry the selection.",
            );
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (!location)
              throw new OnshapeHttpError(
                502,
                "Onshape returned a redirect without a download location.",
              );
            const destination = new URL(location, url);
            if (
              destination.protocol !== "https:" ||
              destination.username ||
              destination.password ||
              destination.port ||
              (destination.origin !== origin &&
                !options.artifactHosts?.includes(destination.hostname))
            )
              throw new OnshapeHttpError(
                502,
                "Export redirected to an unreviewed artifact host. Add only a verified Onshape download host to server configuration.",
              );
            if (
              destination.origin !== origin &&
              (!requestOptions?.binary || nextMethod !== "GET")
            )
              throw new OnshapeHttpError(
                502,
                "Only geometry downloads may follow an external artifact redirect.",
              );
            if (response.status === 303) nextMethod = "GET";
            url = destination;
            await response.body?.cancel();
            continue;
          }
          if (!response.ok)
            throw new OnshapeHttpError(
              response.status,
              reason(response.status),
            );
          const maxBytes = requestOptions?.binary
            ? 20 * 1024 * 1024
            : 8 * 1024 * 1024;
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader)
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maxBytes) {
                await reader.cancel();
                throw new OnshapeHttpError(
                  413,
                  "Onshape response exceeds the transfer limit. Import fewer parts or reduce CAD tessellation and retry.",
                );
              }
              chunks.push(chunk.value);
            }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (requestOptions?.binary) return bytes.buffer as T;
          if (response.status === 204) return undefined as T;
          try {
            return JSON.parse(new TextDecoder().decode(bytes)) as T;
          } catch {
            throw new OnshapeHttpError(
              502,
              "Onshape returned unreadable JSON. Check the API version or retry later.",
            );
          }
        }
        throw new OnshapeHttpError(502, "Too many Onshape export redirects.");
      } catch (error) {
        if (requestOptions?.signal?.aborted)
          throw new DOMException("Onshape request cancelled.", "AbortError");
        if (timeout.aborted)
          throw new OnshapeHttpError(
            504,
            "Onshape request timed out after 45 seconds. Retry; no geometry was accepted.",
          );
        if (error instanceof OnshapeHttpError) throw error;
        // Network errors may contain signed redirect URLs or account metadata. Never echo those bodies/messages to the browser.
        throw new OnshapeHttpError(
          502,
          "The server could not reach Onshape. Check network access and retry.",
        );
      }
    },
  };
}
