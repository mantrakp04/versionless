import { expect, test } from "bun:test";
import { SandboxQueryScheduler } from "./mdx-message";

test("queues dashboard queries above the concurrency limit instead of failing them", async () => {
  const scheduler = new SandboxQueryScheduler(2, 8);
  const releases: Array<() => void> = [];
  let started = 0;

  const queries = Array.from({ length: 5 }, (_, index) =>
    scheduler.run(
      () =>
        new Promise<number>((resolve) => {
          started += 1;
          releases.push(() => resolve(index));
        }),
    ),
  );

  await Promise.resolve();
  expect(started).toBe(2);

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toBe(3);

  while (releases.length > 0) {
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(await Promise.all(queries)).toEqual([0, 1, 2, 3, 4]);
});
