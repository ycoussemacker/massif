/** Faux client Supabase pour les tests — surveille les ÉCRITURES et sert des lignes en mémoire.
 *
 *  Il existe pour une raison précise : prouver l'invariant d'écriture de l'agent par EXÉCUTION, pas par
 *  relecture. Toute écriture sur une table autre que celles explicitement autorisées LÈVE, donc un outil
 *  qui muterait l'état d'entraînement fait échouer le test au lieu de passer inaperçu.
 *
 *  Il reproduit juste assez du builder PostgREST pour les chaînes réellement utilisées : les filtres et
 *  l'ordre renvoient `this`, l'objet est « thenable » (donc `await` marche à n'importe quel maillon), et
 *  `.limit()` / `.single()` / `.maybeSingle()` résolvent. Les filtres sont VOLONTAIREMENT non appliqués :
 *  ce module teste qui écrit quoi, pas la sémantique de PostgREST. */

export type Op = { table: string; verb: "select" | "insert" | "update" | "upsert" | "delete"; payload?: unknown };

export type FakeDb = Record<string, Record<string, unknown>[]>;

export class WriteViolation extends Error {
  constructor(public table: string, public verb: string) {
    super(`ÉCRITURE INTERDITE : ${verb} sur « ${table} ». Un outil de l'agent ne doit jamais muter ` +
          `l'état d'entraînement — seule une action validée par l'athlète le peut.`);
    this.name = "WriteViolation";
  }
}

/** `writableTables` : la liste blanche. Tout le reste est en lecture seule et lève à l'écriture. */
export function makeFakeSupabase(db: FakeDb, writableTables: string[] = []) {
  const ops: Op[] = [];
  const violations: Op[] = [];
  const writable = new Set(writableTables);
  let autoId = 0;

  // ORDRE CRITIQUE : on ENREGISTRE d'abord, on lève ensuite. L'inverse — lever avant d'enregistrer —
  // rendait le harnais complice : un `try { … } catch {}` autour d'une écriture interdite (motif qui
  // existe déjà sur le chemin des outils, coach-proposals.ts) avalait la WriteViolation, `ops` restait
  // vide, et le test passait au vert PENDANT qu'une écriture partait en production. La liste
  // `violations` survit donc au catch, et le test l'assertionne vide.
  function builder(table: string, verb: Op["verb"], payload?: unknown) {
    ops.push({ table, verb, payload });
    if (verb !== "select" && !writable.has(table)) {
      violations.push({ table, verb, payload });
      throw new WriteViolation(table, verb);
    }
    const rows = () => {
      if (verb === "select") return db[table] ?? [];
      if (verb === "insert") {
        const inserted = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
        return inserted.map((r) => ({ id: `fake-${++autoId}`, ...r }));
      }
      return [];
    };
    const result = () => Promise.resolve({ data: rows(), error: null });
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, neq: () => chain, gte: () => chain, lte: () => chain,
      gt: () => chain, lt: () => chain, in: () => chain, is: () => chain, order: () => chain,
      not: Object.assign(() => chain, { is: () => chain }),
      // `limit`/`range` rendent la CHAÎNE (thenable) et non une promesse : du vrai builder on peut
      // encore enchaîner `.maybeSingle()` après un `.limit(1)`, et `await q.limit(n)` marche quand même.
      range: () => chain,
      limit: () => chain,
      single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return chain;
  }

  const client = {
    /** `rpc` est une surface d'écriture à part entière (une fonction Postgres peut muter). Le harnais
     *  n'en modélisait aucune : tout appel est donc traité comme une violation, à charge d'élargir
     *  explicitement le jour où un outil en aura légitimement besoin. */
    rpc(fn: string) {
      ops.push({ table: `rpc:${fn}`, verb: "update" });
      violations.push({ table: `rpc:${fn}`, verb: "update" });
      throw new WriteViolation(`rpc:${fn}`, "rpc");
    },
    from(table: string) {
      return {
        select: (..._a: unknown[]) => builder(table, "select"),
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        upsert: (payload: unknown) => builder(table, "upsert", payload),
        delete: () => builder(table, "delete"),
      };
    },
  };

  return {
    client,
    ops,
    /** Les écritures interdites TENTÉES, même si l'appelant a avalé l'exception. */
    violations,
    writes: () => ops.filter((o) => o.verb !== "select"),
    tablesWritten: () => [...new Set(ops.filter((o) => o.verb !== "select").map((o) => o.table))].sort(),
  };
}
