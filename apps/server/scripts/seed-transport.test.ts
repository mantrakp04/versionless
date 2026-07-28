import { expect, test } from "bun:test";

import { postSeedBatch } from "./seed-transport";

test("retries Collector backpressure without dropping the seed batch", async () => {
  const responses = [
    new Response("sending queue is full", { status: 503 }),
    new Response(null, { status: 200 }),
  ];
  const delays: number[] = [];
  const bodies: string[] = [];

  await postSeedBatch({
    url: "http://collector.test/v1/logs",
    body: { resourceLogs: [{ records: [1, 2, 3] }] },
    fetchImpl: (async (_url, init) => {
      bodies.push(String(init?.body));
      return responses.shift()!;
    }) as typeof fetch,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  expect(delays).toEqual([150]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
});
