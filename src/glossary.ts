import { tokenize } from './text.js';

/** Weight of a term added from the glossary, compared with 1 for a term typed by the user. */
const EXPANSION_WEIGHT = 0.5;

/**
 * Cross-language equivalents of common legal concepts. A query that contains every
 * word of one term also searches for the other terms of that concept, at half weight.
 * This is a hand-written list: it covers the concepts most often searched, not all of law.
 */
const CONCEPTS: string[][] = [
  ['réclamation', 'plainte', 'complaint', 'Beschwerde', 'Reklamation', 'reclamação', 'reclamo', 'queja', 'şikayet', '投诉', 'reklamacja'],
  ['consommateur', 'consumer', 'Verbraucher', 'consumidor', 'consumatore', 'tüketici', '消费者'],
  ['mise en demeure', 'demand letter', 'Abmahnung', 'Mahnung', 'diffida', 'ihtar', 'requerimiento', '催告'],
  ['litige', 'dispute', 'lawsuit', 'Rechtsstreit', 'Klage', 'demanda', 'controversia', 'contenzioso', 'dava', 'pozew', '诉讼'],
  ['remboursement', 'refund', 'Erstattung', 'reembolso', 'rimborso', 'iade', '退款'],
  ['licenciement', 'dismissal', 'termination', 'Kündigung', 'despido', 'licenziamento', 'fesih', 'zwolnienie', '解雇'],
  ['bail', 'lease', 'tenancy', 'locataire', 'tenant', 'Mietvertrag', 'Mieter', 'arrendamiento', 'affitto', 'kira', 'najem'],
  ['confidentialité', 'confidentiality', 'non-disclosure', 'Geheimhaltung', 'Vertraulichkeit', 'confidencialidad', 'riservatezza', 'gizlilik', '保密'],
  ['rgpd', 'gdpr', 'données personnelles', 'personal data', 'Datenschutz', 'protección de datos', 'protezione dei dati', 'veri koruma', '数据保护', 'dane osobowe'],
  ['contrat de travail', 'employment contract', 'Arbeitsvertrag', 'contrato de trabajo', 'contratto di lavoro', 'iş sözleşmesi', '劳动合同'],
  ['contrat', 'contract', 'Vertrag', 'contrato', 'contratto', 'sözleşme', '合同'],
  ['assurance', 'insurance', 'Versicherung', 'seguro', 'assicurazione', 'sigorta', '保险'],
  ['impôt', 'tax', 'Steuer', 'impuesto', 'imposta', 'vergi', '税'],
  ['succession', 'inheritance', 'Erbe', 'Nachlass', 'herencia', 'eredità', 'miras', '遗产'],
  ['divorce', 'divorcio', 'divorzio', 'Scheidung', 'boşanma', '离婚'],
  ['pénal', 'criminal', 'Strafrecht', 'penal', 'penale', 'ceza', '刑事'],
  ['société', 'company', 'GmbH', 'sociedad', 'società', 'şirket', '公司'],
  ['recours', 'appeal', 'Berufung', 'Widerspruch', 'apelación', 'appello', 'istinaf', '上诉'],
  ['facture', 'invoice', 'Rechnung', 'factura', 'fattura', 'fatura'],
];

/**
 * A term can be written in more than one way: "Kündigung" is also "Kuendigung".
 * Each spelling gives one list of tokens, and a term matches if any spelling matches.
 */
function spellings(term: string): string[][] {
  const plain = tokenize(term.replace(/ä/gi, 'a').replace(/ö/gi, 'o').replace(/ü/gi, 'u'));
  const transliterated = tokenize(term.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue'));
  const unique = new Map<string, string[]>();
  for (const tokens of [plain, transliterated]) {
    if (tokens.length > 0) {
      unique.set(tokens.join(' '), tokens);
    }
  }
  return [...unique.values()];
}

/** For each concept, each term, and each spelling of that term, its tokens. */
const CONCEPT_SPELLINGS: string[][][][] = CONCEPTS.map((concept) => concept.map(spellings));

/**
 * Turns a query into weighted search terms. Terms typed by the user have weight 1,
 * and the equivalents of any concept they trigger have weight 0.5.
 */
export function expandQuery(query: string): Map<string, number> {
  const typed = new Set(tokenize(query));
  const weights = new Map<string, number>();
  for (const token of typed) {
    weights.set(token, 1);
  }

  for (const concept of CONCEPT_SPELLINGS) {
    // A term triggers the concept when one of its spellings has every token in the query.
    const triggered = concept.some((spellingsOfTerm) =>
      spellingsOfTerm.some((tokens) => tokens.every((token) => typed.has(token))),
    );
    if (!triggered) {
      continue;
    }
    for (const spellingsOfTerm of concept) {
      for (const tokens of spellingsOfTerm) {
        for (const token of tokens) {
          if (!weights.has(token)) {
            weights.set(token, EXPANSION_WEIGHT);
          }
        }
      }
    }
  }

  return weights;
}
