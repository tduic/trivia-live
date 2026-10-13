// Minimal in-memory stand-in for the parts of "firebase/firestore" the app
// uses. Documents live in a flat Map keyed by slash-joined path, which is
// enough to exercise room / player / scoring logic offline.
type Data = Record<string, any>;

export type DocRef = { kind: "doc"; path: string; id: string };
export type ColRef = { kind: "col"; path: string };

export function createFakeFirestore() {
  const store = new Map<string, Data>();
  const writes: Array<{ op: string; path: string; data?: Data }> = [];

  const join = (segs: string[]) => segs.join("/");

  const snap = (ref: DocRef) => {
    const data = store.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: () => data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
    };
  };

  const children = (col: ColRef) =>
    [...store.keys()]
      .filter((p) => p.startsWith(col.path + "/") && !p.slice(col.path.length + 1).includes("/"))
      .map((p) => docFn(null, ...p.split("/")));

  const docFn = (_db: unknown, ...segs: string[]): DocRef => {
    // doc(collectionRef) with no id → auto id
    if (segs.length === 0 && _db && (_db as any).kind === "col") {
      const id = `auto${store.size + writes.length + 1}`;
      return { kind: "doc", path: `${(_db as ColRef).path}/${id}`, id };
    }
    if (_db && (_db as any).kind === "col") segs = [(_db as ColRef).path, ...segs];
    const path = join(segs);
    return { kind: "doc", path, id: path.split("/").pop()! };
  };

  const setDoc = async (ref: DocRef, data: Data, opts?: { merge?: boolean }) => {
    const prev = opts?.merge ? store.get(ref.path) ?? {} : {};
    store.set(ref.path, { ...prev, ...data });
    writes.push({ op: "set", path: ref.path, data });
  };

  const updateSync = (ref: DocRef, patch: Data) => {
    const prev = store.get(ref.path);
    if (!prev) throw new Error(`No document to update: ${ref.path}`);
    const next = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && v.__op === "increment") next[k] = (next[k] ?? 0) + v.n;
      else if (v && typeof v === "object" && v.__op === "arrayUnion")
        next[k] = [...(next[k] ?? []), ...v.items.filter((i: unknown) => !(next[k] ?? []).includes(i))];
      else next[k] = v;
    }
    store.set(ref.path, next);
    writes.push({ op: "update", path: ref.path, data: patch });
  };

  const api = {
    doc: docFn,
    collection: (_db: unknown, ...segs: string[]): ColRef => ({ kind: "col", path: join(segs) }),
    query: (col: ColRef, ..._constraints: unknown[]) => col,
    orderBy: (..._a: unknown[]) => ({}),
    where: (..._a: unknown[]) => ({}),
    limit: (..._a: unknown[]) => ({}),
    serverTimestamp: () => "SERVER_TS",
    increment: (n: number) => ({ __op: "increment", n }),
    arrayUnion: (...items: unknown[]) => ({ __op: "arrayUnion", items }),
    Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
    getDoc: async (ref: DocRef) => snap(ref),
    getDocs: async (col: ColRef) => {
      const docs = children(col).map(snap);
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: any) => docs.forEach(fn) };
    },
    setDoc,
    addDoc: async (col: ColRef, data: Data) => {
      const ref = docFn(col);
      await setDoc(ref, data);
      return ref;
    },
    updateDoc: async (ref: DocRef, patch: Data) => updateSync(ref, patch),
    deleteDoc: async (ref: DocRef) => {
      store.delete(ref.path);
      writes.push({ op: "delete", path: ref.path });
    },
    runTransaction: async (_db: unknown, fn: (tx: any) => Promise<unknown>) =>
      fn({
        get: async (ref: DocRef) => snap(ref),
        update: (ref: DocRef, patch: Data) => updateSync(ref, patch),
        set: (ref: DocRef, data: Data, opts?: { merge?: boolean }) => {
          const prev = opts?.merge ? store.get(ref.path) ?? {} : {};
          store.set(ref.path, { ...prev, ...data });
        },
        delete: (ref: DocRef) => store.delete(ref.path),
      }),
    writeBatch: () => {
      const ops: Array<() => void> = [];
      return {
        update: (ref: DocRef, patch: Data) => ops.push(() => updateSync(ref, patch)),
        set: (ref: DocRef, data: Data) => ops.push(() => store.set(ref.path, { ...data })),
        delete: (ref: DocRef) => ops.push(() => store.delete(ref.path)),
        commit: async () => ops.forEach((o) => o()),
      };
    },
    onSnapshot: (target: DocRef | ColRef, cb: (s: any) => void) => {
      if (target.kind === "doc") cb(snap(target));
      else cb({ docs: children(target).map(snap) });
      return () => {};
    },
  };

  return {
    api,
    store,
    writes,
    get: (path: string) => store.get(path),
    put: (path: string, data: Data) => store.set(path, { ...data }),
    reset() {
      store.clear();
      writes.length = 0;
    },
  };
}
