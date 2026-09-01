/** Tests des bornes de lecture des outils de l'agent. Run : `npx tsx --test src/lib/agent/limits.test.ts`
 *  Purs (aucune base) : `fetchBounded` est exercé avec un faux builder PostgREST qui compte la limite
 *  réellement demandée — c'est le `+1` qui rend la troncature détectable, donc il doit être testé. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS, NOT_TRUNCATED, clampWindow, daysBetween, shiftDate, isIsoDate, mergeTruncation, fetchBounded,
} from "./limits";

/** Faux builder : rend `n` lignes numérotées et retient la limite demandée. */
function fakeQuery(available: number) {
  const seen: number[] = [];
  return {
    seen,
    limit(n: number) {
      seen.push(n);
      const rows = Array.from({ length: Math.min(n, available) }, (_, i) => ({ i }));
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

test("daysBetween est inclusif", () => {
  assert.equal(daysBetween("2026-01-01", "2026-01-01"), 1);
  assert.equal(daysBetween("2026-01-01", "2026-01-31"), 31);
  assert.equal(daysBetween("2021-01-01", "2026-09-01"), 2070);
});

test("shiftDate traverse les mois et les années", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDate("2026-09-01", 13), "2026-09-14");
});

test("isIsoDate rejette ce que le modèle peut inventer", () => {
  assert.ok(isIsoDate("2026-09-01"));
  for (const bad of ["juin", "2026-9-1", "01/09/2026", "2026-13-01", "", null, 20260901]) {
    assert.equal(isIsoDate(bad), false, `devrait rejeter ${JSON.stringify(bad)}`);
  }
});

test("clampWindow laisse passer une fenêtre sous le plafond", () => {
  const r = clampWindow("2026-06-01", "2026-09-01", 400, "modèle quotidien");
  assert.equal(r.truncated, false);
  assert.equal(r.since, "2026-06-01");
  assert.equal(r.until, "2026-09-01");
});

test("clampWindow garde le bout RÉCENT et le dit", () => {
  // La question qui déclenchait le bug : « compare 2022 à 2026 » en un seul appel.
  const r = clampWindow("2022-01-01", "2026-09-01", 400, "modèle quotidien");
  assert.equal(r.truncated, true);
  assert.equal(r.until, "2026-09-01", "la borne haute ne bouge pas");
  assert.equal(daysBetween(r.since, r.until), 400);
  assert.equal(r.since, "2025-07-29");
  assert.deepEqual(r.window_applied, { since: "2025-07-29", until: "2026-09-01" });
  assert.match(r.note ?? "", /n'est PAS dans cette réponse/);
  assert.match(r.note ?? "", /fenêtre plus étroite/);
});

test("fetchBounded : sous la limite, rien n'est signalé", async () => {
  const q = fakeQuery(12);
  const { rows, truncation } = await fetchBounded(q, 300, { what: "activités" });
  assert.equal(rows.length, 12);
  assert.deepEqual(truncation, NOT_TRUNCATED);
  assert.deepEqual(q.seen, [301], "doit demander limit+1 pour détecter le débordement");
});

test("fetchBounded : exactement la limite n'est PAS une troncature", async () => {
  // Le piège que le +1 existe pour éviter : 300 lignes rendues peut vouloir dire « il y en a 300 »
  // ou « il y en a plus » — sans la ligne sentinelle on ne peut pas trancher.
  const { rows, truncation } = await fetchBounded(fakeQuery(300), 300, { what: "activités" });
  assert.equal(rows.length, 300);
  assert.equal(truncation.truncated, false);
});

test("fetchBounded : au-dessus de la limite, la réponse le dit", async () => {
  const { rows, truncation } = await fetchBounded(fakeQuery(5000), 300, { what: "activités" });
  assert.equal(rows.length, 300, "on rend la limite, pas la sentinelle");
  assert.equal(truncation.truncated, true);
  assert.match(truncation.note ?? "", /plus RÉCENTES/);
  assert.match(truncation.note ?? "", /resserre ta fenêtre/);
});

test("fetchBounded newestFirst rend l'ordre chronologique", async () => {
  // La requête est ordonnée du plus récent au plus ancien pour que la coupe morde sur l'ancien ;
  // la réponse, elle, doit se lire dans le sens du temps.
  const { rows } = await fetchBounded<{ i: number }>(fakeQuery(5), 3, { what: "jours", newestFirst: true });
  assert.deepEqual(rows.map((r) => r.i), [2, 1, 0]);
});

test("fetchBounded propage l'erreur PostgREST au lieu de rendre une liste vide", async () => {
  const failing = { limit: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  await assert.rejects(() => fetchBounded(failing, 10, { what: "jours" }), /boom/);
});

test("mergeTruncation fusionne fenêtre resserrée + débordement de lignes", () => {
  assert.deepEqual(mergeTruncation(NOT_TRUNCATED, NOT_TRUNCATED), NOT_TRUNCATED);
  const merged = mergeTruncation(
    { truncated: true, note: "A.", window_applied: { since: "2026-01-01", until: "2026-09-01" } },
    { truncated: true, note: "B." },
  );
  assert.equal(merged.truncated, true);
  assert.equal(merged.note, "A. B.");
  assert.deepEqual(merged.window_applied, { since: "2026-01-01", until: "2026-09-01" });
});

test("les plafonds restent bien sous le cap PostgREST de 1000 lignes", () => {
  for (const [k, v] of Object.entries(LIMITS)) {
    assert.ok(v > 0 && v < 1000, `LIMITS.${k} = ${v} doit tenir strictement sous 1000`);
  }
});
