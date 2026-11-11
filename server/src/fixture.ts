import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

export const FIXTURE_HOWTO = `1. Open the Saturday workshop page.
2. Enter your email address.
3. Click "Reserve my seat".`

function existing(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error("The broken demo page is missing from the repo.")
}

export function fixtureHtmlPath(): string {
  return existing([
    resolve(here, "../../fixture/broken.html"),
    resolve(here, "../../../fixture/broken.html"),
  ])
}

export function loadFixtureHtml(): string {
  return readFileSync(fixtureHtmlPath(), "utf8")
}
