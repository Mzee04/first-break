export type SessionRow = { spentUsd: number; calls: number }

export class SessionLedger {
  private readonly rows = new Map<string, SessionRow>()

  get(id: string): SessionRow {
    return this.rows.get(id) ?? { spentUsd: 0, calls: 0 }
  }

  set(id: string, row: SessionRow): void {
    this.rows.set(id, row)
  }
}
