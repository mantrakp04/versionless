const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export interface SeedPostOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (input: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    status: number;
  }) => void;
  maxAttempts?: number;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function postSeedBatch({
  url,
  body,
  headers,
  fetchImpl = fetch,
  sleep = defaultSleep,
  onRetry,
  maxAttempts = 9,
}: SeedPostOptions): Promise<void> {
  const serializedBody = JSON.stringify(body);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: serializedBody,
    });
    if (response.ok) return;

    const responseBody = await response.text();
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts - 1) {
      throw new Error(
        `Collector ingest failed (${response.status}): ${responseBody}`,
      );
    }

    const delayMs = Math.min(4_000, 150 * 2 ** attempt);
    onRetry?.({
      attempt: attempt + 2,
      maxAttempts,
      delayMs,
      status: response.status,
    });
    await sleep(delayMs);
  }
}
