/** Lectures COMPLÈTES paginées — le pendant de `agent/limits.ts`.
 *
 *  Deux besoins opposés, deux réponses, une seule règle (« jamais de troncature muette ») :
 *
 *  • un OUTIL d'agent lit un extrait pour répondre à une question → il BORNE et SIGNALE au modèle ce
 *    qu'il a laissé de côté (`agent/limits.ts`) ;
 *  • un CALCUL sur tout l'historique — le rollup CTL/ATL, la familiarité à la descente — n'a pas de
 *    version « partielle » qui ait un sens : une activité manquante fausse le modèle pour toujours,
 *    sans que rien ne le montre. Il lui faut donc la TOTALITÉ, ce que ce module garantit en paginant.
 *
 *  Le plafond des 1000 lignes de PostgREST rendait ces lectures pleine table correctes seulement tant
 *  que la table restait petite (427 activités au 2026-09-01 — le code portait d'ailleurs la note
 *  « relies on the <1000-activity PostgREST page; paginate if it ever grows »). Au-delà, elles auraient
 *  silencieusement laissé tomber des activités, et le rollup aurait réécrit un historique de charge faux.
 *
 *  Si la pagination dépasse `maxRows`, on LÈVE une erreur au lieu de rendre un résultat partiel : pour
 *  un calcul qui exige la complétude, échouer bruyamment est le seul comportement honnête. */

const PAGE = 1000; // le plafond PostgREST : une page pleine signifie « il y en a peut-être d'autres »

export type PagedQuery<T> = (
  from: number, to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Lit TOUTES les lignes d'une requête, page par page.
 *  `build(from, to)` doit produire la requête avec `.range(from, to)` — un builder PostgREST n'étant pas
 *  réutilisable une fois exécuté, on le reconstruit à chaque page. */
export async function fetchAllPaged<T>(
  build: PagedQuery<T>, opts: { what: string; maxRows?: number },
): Promise<T[]> {
  const maxRows = opts.maxRows ?? 200_000;
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
    if (rows.length >= maxRows) {
      throw new Error(
        `Lecture de ${opts.what} interrompue à ${rows.length} lignes (plafond de sécurité ${maxRows}). ` +
        `Un calcul qui exige l'historique complet ne doit pas se contenter d'une partie : relève le ` +
        `plafond ou restreins la requête, mais ne laisse pas passer un résultat partiel.`,
      );
    }
  }
}
