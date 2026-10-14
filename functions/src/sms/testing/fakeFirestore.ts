/**
 * Minimal in-memory Firestore for SMS unit tests. Models only the surface the
 * SMS functions use: nested collection/doc refs, get/set/update/create/delete,
 * batches, transactions, getAll, and filtered/ordered/paginated queries
 * (including collection groups). Test-only; never imported by production code.
 */

export type FakeData = Record<string, unknown>

export class FakeDeleteSentinel {}
export const DELETE_FIELD = new FakeDeleteSentinel()

export class FakeTimestamp {
  constructor(private readonly ms: number) {}
  toMillis(): number {
    return this.ms
  }
}

export interface FakeWriteOp {
  kind: 'set' | 'merge' | 'update' | 'create' | 'delete'
  path: string
  data?: FakeData
}

class FakeError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message)
  }
}

function isPlainObject(value: unknown): value is FakeData {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => clone(item)) as unknown as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }
  return value
}

function readField(data: FakeData, field: string): unknown {
  let current: unknown = data
  for (const part of field.split('.')) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

function writeField(data: FakeData, field: string, value: unknown): void {
  const parts = field.split('.')
  let current = data
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(current[part])) current[part] = {}
    current = current[part] as FakeData
  }
  const last = parts[parts.length - 1]
  if (value instanceof FakeDeleteSentinel) delete current[last]
  else current[last] = clone(value)
}

function deepMerge(target: FakeData, source: FakeData): void {
  for (const [key, value] of Object.entries(source)) {
    if (value instanceof FakeDeleteSentinel) delete target[key]
    else if (isPlainObject(value) && isPlainObject(target[key])) deepMerge(target[key] as FakeData, value)
    else target[key] = clone(value)
  }
}

function stripSentinels(data: FakeData): FakeData {
  const result: FakeData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FakeDeleteSentinel) continue
    result[key] = isPlainObject(value) ? stripSentinels(value) : clone(value)
  }
  return result
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''))
}

export class FakeDocumentSnapshot {
  constructor(
    readonly ref: FakeDocumentReference,
    private readonly value: FakeData | undefined,
  ) {}
  get id(): string {
    return this.ref.id
  }
  get exists(): boolean {
    return this.value !== undefined
  }
  data(): FakeData | undefined {
    return this.value === undefined ? undefined : clone(this.value)
  }
  get(field: string): unknown {
    return this.value === undefined ? undefined : readField(this.value, field)
  }
}

interface Filter {
  field: string
  op: string
  value: unknown
}

export class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    private readonly scope: { kind: 'collection'; path: string } | { kind: 'group'; id: string },
    private readonly filters: Filter[] = [],
    private readonly orders: Array<{ field: string; direction: 'asc' | 'desc' }> = [],
    private readonly limitCount: number | null = null,
    private readonly afterPath: string | null = null,
  ) {}

  private next(changes: Partial<{
    filters: Filter[]
    orders: Array<{ field: string; direction: 'asc' | 'desc' }>
    limitCount: number | null
    afterPath: string | null
  }>): FakeQuery {
    return new FakeQuery(
      this.db,
      this.scope,
      changes.filters ?? this.filters,
      changes.orders ?? this.orders,
      changes.limitCount !== undefined ? changes.limitCount : this.limitCount,
      changes.afterPath !== undefined ? changes.afterPath : this.afterPath,
    )
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return this.next({ filters: [...this.filters, { field, op, value }] })
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery {
    return this.next({ orders: [...this.orders, { field, direction }] })
  }

  limit(count: number): FakeQuery {
    return this.next({ limitCount: count })
  }

  startAfter(snapshot: FakeDocumentSnapshot): FakeQuery {
    return this.next({ afterPath: snapshot.ref.path })
  }

  private belongs(path: string): boolean {
    const segments = path.split('/')
    if (this.scope.kind === 'collection') return segments.slice(0, -1).join('/') === this.scope.path
    return segments.length >= 2 && segments[segments.length - 2] === this.scope.id
  }

  private matches(data: FakeData): boolean {
    return this.filters.every(({ field, op, value }) => {
      const actual = readField(data, field)
      switch (op) {
        case '==': return actual === value
        case '!=': return actual !== value
        case 'in': return Array.isArray(value) && value.includes(actual)
        case 'not-in': return Array.isArray(value) && !value.includes(actual)
        case '<': return typeof actual === 'number' && typeof value === 'number' && actual < value
        case '<=': return typeof actual === 'number' && typeof value === 'number' && actual <= value
        case '>': return typeof actual === 'number' && typeof value === 'number' && actual > value
        case '>=': return typeof actual === 'number' && typeof value === 'number' && actual >= value
        default: throw new Error(`fake firestore: unsupported operator ${op}`)
      }
    })
  }

  async get(): Promise<{ docs: FakeDocumentSnapshot[]; empty: boolean; size: number }> {
    this.db.queryLog.push(this.scope.kind === 'collection' ? this.scope.path : `group:${this.scope.id}`)
    let entries = [...this.db.store.entries()]
      .filter(([path, data]) => this.belongs(path) && this.matches(data))
      .sort(([pathA, dataA], [pathB, dataB]) => {
        for (const { field, direction } of this.orders) {
          const order = compare(readField(dataA, field), readField(dataB, field))
          if (order !== 0) return direction === 'asc' ? order : -order
        }
        return pathA.localeCompare(pathB)
      })
    if (this.afterPath) {
      const index = entries.findIndex(([path]) => path === this.afterPath)
      entries = index >= 0 ? entries.slice(index + 1) : entries
    }
    if (this.limitCount !== null) entries = entries.slice(0, this.limitCount)
    const docs = entries.map(([path, data]) => new FakeDocumentSnapshot(this.db.doc(path), data))
    return { docs, empty: docs.length === 0, size: docs.length }
  }
}

export class FakeCollectionReference extends FakeQuery {
  constructor(db: FakeFirestore, readonly path: string) {
    super(db, { kind: 'collection', path })
  }
  get id(): string {
    return this.path.split('/').pop() ?? ''
  }
  get parent(): FakeDocumentReference | null {
    const segments = this.path.split('/')
    return segments.length > 1 ? this.db.doc(segments.slice(0, -1).join('/')) : null
  }
  doc(id: string): FakeDocumentReference {
    return this.db.doc(`${this.path}/${id}`)
  }
}

export class FakeDocumentReference {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}
  get id(): string {
    return this.path.split('/').pop() ?? ''
  }
  get parent(): FakeCollectionReference {
    return this.db.collection(this.path.split('/').slice(0, -1).join('/'))
  }
  collection(name: string): FakeCollectionReference {
    return this.db.collection(`${this.path}/${name}`)
  }
  async get(): Promise<FakeDocumentSnapshot> {
    this.db.readLog.push(this.path)
    return new FakeDocumentSnapshot(this, this.db.store.get(this.path))
  }
  async set(data: FakeData, options?: { merge?: boolean }): Promise<void> {
    this.db.apply([{ kind: options?.merge ? 'merge' : 'set', path: this.path, data }])
  }
  async update(data: FakeData): Promise<void> {
    this.db.apply([{ kind: 'update', path: this.path, data }])
  }
  async create(data: FakeData): Promise<void> {
    this.db.apply([{ kind: 'create', path: this.path, data }])
  }
  async delete(): Promise<void> {
    this.db.apply([{ kind: 'delete', path: this.path }])
  }
}

export class FakeWriteBatch {
  private readonly ops: FakeWriteOp[] = []
  constructor(private readonly db: FakeFirestore) {}
  set(ref: FakeDocumentReference, data: FakeData, options?: { merge?: boolean }): this {
    this.ops.push({ kind: options?.merge ? 'merge' : 'set', path: ref.path, data })
    return this
  }
  update(ref: FakeDocumentReference, data: FakeData): this {
    this.ops.push({ kind: 'update', path: ref.path, data })
    return this
  }
  create(ref: FakeDocumentReference, data: FakeData): this {
    this.ops.push({ kind: 'create', path: ref.path, data })
    return this
  }
  delete(ref: FakeDocumentReference): this {
    this.ops.push({ kind: 'delete', path: ref.path })
    return this
  }
  async commit(): Promise<void> {
    this.db.apply(this.ops)
  }
}

export class FakeTransaction extends FakeWriteBatch {
  async get(ref: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return ref.get()
  }
}

export class FakeFirestore {
  readonly store = new Map<string, FakeData>()
  readonly writeLog: FakeWriteOp[] = []
  readonly queryLog: string[] = []
  readonly readLog: string[] = []
  /** Throw from here to simulate a failed write (checked before applying). */
  beforeWrite: ((ops: FakeWriteOp[]) => void) | null = null

  reset(): void {
    this.store.clear()
    this.writeLog.length = 0
    this.queryLog.length = 0
    this.readLog.length = 0
    this.beforeWrite = null
  }

  seed(path: string, data: FakeData): void {
    this.store.set(path, clone(data))
  }

  read(path: string): FakeData | undefined {
    const data = this.store.get(path)
    return data === undefined ? undefined : clone(data)
  }

  paths(prefix: string): string[] {
    return [...this.store.keys()].filter(path => path.startsWith(prefix)).sort()
  }

  collection(path: string): FakeCollectionReference {
    return new FakeCollectionReference(this, path)
  }

  doc(path: string): FakeDocumentReference {
    return new FakeDocumentReference(this, path)
  }

  collectionGroup(id: string): FakeQuery {
    return new FakeQuery(this, { kind: 'group', id })
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this)
  }

  async runTransaction<T>(fn: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction(this)
    const result = await fn(transaction)
    await transaction.commit()
    return result
  }

  async getAll(...refs: FakeDocumentReference[]): Promise<FakeDocumentSnapshot[]> {
    return Promise.all(refs.map(ref => ref.get()))
  }

  apply(ops: FakeWriteOp[]): void {
    if (ops.length === 0) return
    this.beforeWrite?.(ops)
    // Validate first so a failing op leaves the whole write unapplied.
    for (const op of ops) {
      if (op.kind === 'create' && this.store.has(op.path)) throw new FakeError(6, 'ALREADY_EXISTS')
      if (op.kind === 'update' && !this.store.has(op.path)) throw new FakeError(5, 'NOT_FOUND')
    }
    for (const op of ops) {
      this.writeLog.push(op)
      const data = op.data ?? {}
      if (op.kind === 'delete') {
        this.store.delete(op.path)
      } else if (op.kind === 'set' || op.kind === 'create') {
        this.store.set(op.path, stripSentinels(data))
      } else if (op.kind === 'merge') {
        const target = this.store.get(op.path) ?? {}
        deepMerge(target, data)
        this.store.set(op.path, target)
      } else {
        const target = this.store.get(op.path) as FakeData
        for (const [field, value] of Object.entries(data)) writeField(target, field, value)
      }
    }
  }
}

export const fakeDb = new FakeFirestore()

/** Factory for `vi.mock('firebase-admin/firestore', ...)`. */
export function fakeFirestoreModule() {
  return {
    getFirestore: () => fakeDb,
    FieldValue: { delete: () => DELETE_FIELD },
    Timestamp: { fromMillis: (ms: number) => new FakeTimestamp(ms) },
  }
}
