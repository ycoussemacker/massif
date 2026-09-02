/** Base PostgREST en mémoire — le socle des évals.
 *
 *  Pourquoi pas un instantané de la vraie base : le dépôt est PUBLIC, et les données d'entraînement d'un
 *  athlète (sommeil, VFC, FC de repos) sont des données de santé. La fixture est donc GÉNÉRÉE
 *  (`fixture.ts`), ce qui a trois avantages sur un dump : rien de personnel n'est publié, quiconque
 *  clone le dépôt peut lancer les évals, et les cas limites (un trou de deux semaines, une récupération
 *  absente, un objectif à J−21) sont posés exactement où on les veut au lieu d'être espérés.
 *
 *  Ce module implémente juste assez de PostgREST pour que les outils s'exécutent POUR DE VRAI :
 *  filtres, tri, pagination, comptage exact — et surtout le PLAFOND DE 1000 LIGNES, sans lequel le cas
 *  de non-régression sur la troncature ne prouverait rien.
 *
 *  Un opérateur non implémenté LÈVE au lieu de rendre un résultat approximatif : une fixture qui ment
 *  silencieusement est pire que pas de fixture. */

export const POSTGREST_MAX_ROWS = 1000;

export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

type Filter = { op: string; col: string; val: any };
type Order = { col: string; asc: boolean; nullsFirst: boolean };

const cmp = (a: any, b: any): number => {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

/** `col->>key` : accès JSONB, tel que l'utilise la recherche par mot-clé. */
function get(row: Row, col: string): any {
  const m = col.match(/^([a-z_]+)->>([a-z_]+)$/);
  if (!m) return row[col];
  const parent = row[m[1]];
  return parent && typeof parent === "object" ? parent[m[2]] : undefined;
}

function matches(row: Row, f: Filter): boolean {
  const v = get(row, f.col);
  switch (f.op) {
    case "eq": return v === f.val;
    case "neq": return v !== f.val;
    case "gt": return cmp(v, f.val) > 0;
    case "gte": return cmp(v, f.val) >= 0;
    case "lt": return cmp(v, f.val) < 0;
    case "lte": return cmp(v, f.val) <= 0;
    case "in": return (f.val as any[]).includes(v);
    case "is": return f.val === null ? v == null : v === f.val;
    case "not.is": return f.val === null ? v != null : v !== f.val;
    case "or": {
      // `col->>k.ilike.*mot*,col2->>k2.ilike.*mot*` — la grammaire réellement produite par listActivities.
      return String(f.val).split(",").some((clause) => {
        const mm = clause.match(/^(.+?)\.ilike\.\*(.*)\*$/);
        if (!mm) throw new Error(`clause .or() non gérée par la fixture : ${clause}`);
        const cell = get(row, mm[1]);
        return cell != null && String(cell).toLowerCase().includes(mm[2].toLowerCase());
      });
    }
    default: throw new Error(`opérateur non géré par la fixture : ${f.op}`);
  }
}

export function makeFixtureDb(tables: Tables) {
  const db: Tables = JSON.parse(JSON.stringify(tables));
  let autoId = 0;
  const nextId = () => `fx-${String(++autoId).padStart(4, "0")}`;

  function query(table: string) {
    const filters: Filter[] = [];
    const orders: Order[] = [];
    let range: { from: number; to: number } | null = null;
    let wantCount = false;
    let verb: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row[] = [];

    const run = () => {
      const source = db[table] ?? (db[table] = []);
      if (verb === "insert" || verb === "upsert") {
        const added = payload.map((r) => ({ id: r.id ?? nextId(), ...r }));
        source.push(...added);
        return { data: added, error: null, count: added.length };
      }
      let rows = source.filter((r) => filters.every((f) => matches(r, f)));
      if (verb === "update") {
        for (const r of rows) Object.assign(r, payload[0]);
        return { data: rows, error: null, count: rows.length };
      }
      if (verb === "delete") {
        for (const r of rows) source.splice(source.indexOf(r), 1);
        return { data: rows, error: null, count: rows.length };
      }
      const total = rows.length;
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = get(a, o.col), bv = get(b, o.col);
          if (av == null || bv == null) {
            if (av == null && bv == null) return 0;
            return (av == null ? -1 : 1) * (o.nullsFirst ? 1 : -1);
          }
          return o.asc ? cmp(av, bv) : -cmp(av, bv);
        });
      }
      if (range) rows = rows.slice(range.from, range.to + 1);
      // LE PLAFOND. C'est lui qui rend le cas de non-régression sur la troncature honnête : sans requête
      // bornée, PostgREST rend 1000 lignes et rien ne le dit.
      const capped = rows.slice(0, POSTGREST_MAX_ROWS);
      return { data: capped, error: null, count: wantCount ? total : null };
    };

    const chain: any = {
      select(_cols?: string, opts?: { count?: string }) { if (opts?.count === "exact") wantCount = true; return chain; },
      insert(p: Row | Row[]) { verb = "insert"; payload = Array.isArray(p) ? p : [p]; return chain; },
      update(p: Row) { verb = "update"; payload = [p]; return chain; },
      upsert(p: Row | Row[]) { verb = "upsert"; payload = Array.isArray(p) ? p : [p]; return chain; },
      delete() { verb = "delete"; return chain; },
      eq(c: string, v: any) { filters.push({ op: "eq", col: c, val: v }); return chain; },
      neq(c: string, v: any) { filters.push({ op: "neq", col: c, val: v }); return chain; },
      gt(c: string, v: any) { filters.push({ op: "gt", col: c, val: v }); return chain; },
      gte(c: string, v: any) { filters.push({ op: "gte", col: c, val: v }); return chain; },
      lt(c: string, v: any) { filters.push({ op: "lt", col: c, val: v }); return chain; },
      lte(c: string, v: any) { filters.push({ op: "lte", col: c, val: v }); return chain; },
      in(c: string, v: any[]) { filters.push({ op: "in", col: c, val: v }); return chain; },
      is(c: string, v: any) { filters.push({ op: "is", col: c, val: v }); return chain; },
      or(expr: string) { filters.push({ op: "or", col: "*", val: expr }); return chain; },
      not: { is: (c: string, v: any) => { filters.push({ op: "not.is", col: c, val: v === "null" ? null : v }); return chain; } },
      order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
        orders.push({ col: c, asc: o?.ascending !== false, nullsFirst: o?.nullsFirst ?? true }); return chain;
      },
      // Rendent la CHAÎNE (thenable), pas une promesse : le vrai builder autorise `.limit(1).maybeSingle()`,
      // et `await q.limit(n)` fonctionne quand même.
      limit(n: number) { range = { from: 0, to: n - 1 }; return chain; },
      range(a: number, b: number) { range = { from: a, to: b }; return chain; },
      single() { const r = run(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      maybeSingle() { const r = run(); return Promise.resolve({ ...r, data: r.data[0] ?? null }); },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  }

  return {
    tables: db,
    client: { from: (t: string) => query(t), rpc: () => { throw new Error("rpc() non géré par la fixture"); } },
  };
}
