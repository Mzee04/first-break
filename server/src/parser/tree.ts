import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ReadingIssue, ReadingItem, ReadingTree } from "../types.js"

const here = dirname(fileURLToPath(import.meta.url))

export function parserScriptPath(): string {
  return resolve(here, "../../parser/reading_order.py")
}

function isItem(value: unknown): value is ReadingItem {
  if (!value || typeof value !== "object") return false
  const item = value as ReadingItem
  return typeof item.ref === "string" && (item.kind === "title" || item.kind === "heading" || item.kind === "control")
}

function isIssue(value: unknown): value is ReadingIssue {
  if (!value || typeof value !== "object") return false
  const issue = value as ReadingIssue
  return typeof issue.ref === "string" && typeof issue.detail === "string" && (issue.kind === "skipped-heading" || issue.kind === "missing-name")
}

export function assertTree(value: unknown): ReadingTree {
  if (!value || typeof value !== "object") throw new Error("Parser returned no tree.")
  const tree = value as ReadingTree
  if (tree.sourceKind !== "html" && tree.sourceKind !== "markdown") throw new Error("Parser returned an unknown source kind.")
  if (typeof tree.title !== "string" || !Array.isArray(tree.items) || !Array.isArray(tree.issues)) {
    throw new Error("Parser JSON is missing title, items, or issues.")
  }
  if (!tree.items.every(isItem) || !tree.issues.every(isIssue)) throw new Error("Parser JSON has an item the app does not recognise.")
  return tree
}

export function buildCodeExecutionSource(html: string): string {
  const file = readFileSync(parserScriptPath(), "utf8")
  const marker = "\nif __name__ == \"__main__\":\n    main()\n"
  if (!file.endsWith(marker) && !file.includes(marker)) {
    throw new Error("The reading-order parser has no entrypoint to wrap for Otari.")
  }
  const stripped = file.replace(marker, "\n")
  const encoded = Buffer.from(html, "utf8").toString("base64")
  return `${stripped}_PAGE = base64.b64decode(${JSON.stringify(encoded)}).decode("utf-8")\njson.dump(parse_document(_PAGE), sys.stdout, ensure_ascii=False)\n`
}

export function parseWithLocalPython(html: string): Promise<ReadingTree> {
  return new Promise((resolveTree, reject) => {
    const child = spawn("python3", [parserScriptPath()], { stdio: ["pipe", "pipe", "pipe"] })
    let out = ""
    let err = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("The local parser timed out."))
    }, 8000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      out += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      err += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(err.trim() || `The local parser exited ${code}.`))
        return
      }
      try {
        resolveTree(assertTree(JSON.parse(out)))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(html)
  })
}
