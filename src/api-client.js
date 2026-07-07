const DEFAULT_TIMEOUT_MS = 12000;
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const warmupPromises = new Map();

function createTimeoutError(timeoutMs) {
  const error = new Error(`Délai serveur dépassé après ${Math.round(timeoutMs / 1000)} s`);
  error.name = "TimeoutError";
  error.code = "API_TIMEOUT";
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(
  input,
  options = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => controller.abort(createTimeoutError(timeoutMs)), timeoutMs);
  try {
    return await fetch(input, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : createTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function fetchWithStartupRetry(
  input,
  options = {},
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelaysMs = [900, 1800],
    retryUnsafeMethod = false,
  } = {},
) {
  const method = String(options.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD" || retryUnsafeMethod;
  let lastError = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, options, { timeoutMs });
      if (
        !canRetry ||
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === retryDelaysMs.length
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (!canRetry || attempt === retryDelaysMs.length) {
        throw error;
      }
    }
    await delay(retryDelaysMs[attempt]);
  }

  throw lastError || new Error("Serveur indisponible");
}

export function warmApiConnection(apiUrl) {
  const normalizedApiUrl = String(apiUrl || "").replace(/\/+$/, "");
  if (!normalizedApiUrl) return Promise.resolve(false);
  if (warmupPromises.has(normalizedApiUrl)) {
    return warmupPromises.get(normalizedApiUrl);
  }

  const promise = fetchWithStartupRetry(
    `${normalizedApiUrl}/api/health?prewarm=1`,
    { cache: "no-store" },
    {
      timeoutMs: 15000,
      retryDelaysMs: [1000, 2500],
    },
  )
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      warmupPromises.delete(normalizedApiUrl);
    });

  warmupPromises.set(normalizedApiUrl, promise);
  return promise;
}
