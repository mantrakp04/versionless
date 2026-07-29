/// <reference types="bun" />

import { expect, test } from "bun:test"

import { badgeVariants } from "./badge"

test("uses a fixed line box so badge text is vertically centered", () => {
  const className = badgeVariants()

  expect(className).toContain("h-5")
  expect(className).toContain("items-center")
  expect(className).toContain("leading-none")
  expect(className).toContain("py-0.5")
})
