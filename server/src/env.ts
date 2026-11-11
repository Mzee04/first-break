import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export function loadDotEnv(here: string): void {
  const candidates = [resolve(here, "../../.env"), resolve(here, "../../../.env")]
  const file = candidates.find((candidate) => existsSync(candidate))
  if (!file) return
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
