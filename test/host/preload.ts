// Loaded before the host test files, through scripts/check.mjs's `bun test --preload`. Bun runs the files of one process
// one after another, and they all use this root and the working directory inside it, so no file may remove it. The
// root goes once, when the run ends, through this file's global afterAll.
import { afterAll } from "bun:test"
import { rmSync } from "node:fs"
import { ROOT } from "./isolate.js"

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
