/** Coût d'un tour d'agent, en micro-dollars.
 *
 *  Les tarifs sont ceux de l'API Anthropic première partie, par million de tokens. Le cache a ses
 *  propres multiplicateurs : une LECTURE de cache coûte ~0,1× le prix d'entrée, une ÉCRITURE ~1,25×
 *  (TTL 5 minutes). Les ignorer fausserait le chiffre dans les deux sens — le contexte de l'athlète
 *  est mis en cache à chaque tour, donc l'essentiel des tokens d'entrée passe par ces deux lignes.
 *
 *  On compte en micro-dollars ENTIERS : un agrégat sur des milliers de tours ne doit pas accumuler
 *  d'erreur de virgule flottante. */

const MICRO = 1_000_000;

/** $ par million de tokens. Modèles absents de la table → estimation nulle plutôt que fausse. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CACHE_READ_FACTOR = 0.1;   // une lecture de cache coûte ~10 % du prix d'entrée
const CACHE_WRITE_FACTOR = 1.25; // une écriture (TTL 5 min) coûte ~125 %

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  calls: number;
};

export const EMPTY_USAGE: Usage = {
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0,
};

/** Additionne l'`usage` d'une réponse API dans un cumul de tour. Tolérant aux champs absents : selon
 *  le modèle et la requête, certains ne sont pas renvoyés. */
export function addUsage(total: Usage, u: unknown): Usage {
  const g = (k: string) => Number((u as Record<string, unknown> | null)?.[k] ?? 0) || 0;
  return {
    input_tokens: total.input_tokens + g("input_tokens"),
    output_tokens: total.output_tokens + g("output_tokens"),
    cache_read_input_tokens: total.cache_read_input_tokens + g("cache_read_input_tokens"),
    cache_creation_input_tokens: total.cache_creation_input_tokens + g("cache_creation_input_tokens"),
    calls: total.calls + 1,
  };
}

/** Coût estimé du tour, en micro-dollars. `null` si le modèle n'est pas tarifé ici — mieux vaut pas
 *  de chiffre qu'un chiffre faux dans une métrique qu'on cite. */
export function costMicroUsd(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const inTok = u.input_tokens + u.cache_read_input_tokens * CACHE_READ_FACTOR
              + u.cache_creation_input_tokens * CACHE_WRITE_FACTOR;
  const usd = (inTok * p.input + u.output_tokens * p.output) / 1_000_000;
  return Math.round(usd * MICRO);
}

export const formatUsd = (micro: number | null | undefined): string =>
  micro == null ? "—" : micro < 10_000 ? `${(micro / 1000).toFixed(2)} m$` : `${(micro / MICRO).toFixed(4)} $`;
