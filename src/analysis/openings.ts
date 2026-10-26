export interface OpeningData {
  /** EPD -> [ECO, nom]. */
  names: Record<string, string[]>;
  book: string[];
}

export interface Opening {
  eco: string;
  name: string;
}

export interface OpeningIndex {
  isBook(fen: string): boolean;
  nameOf(fen: string): Opening | null;
}

/** EPD au sens de la base Lichess : les 4 premiers champs du FEN. */
export function toEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function createOpeningIndex(data: OpeningData): OpeningIndex {
  const book = new Set(data.book);
  return {
    isBook: (fen) => {
      const epd = toEpd(fen);
      return epd in data.names || book.has(epd);
    },
    nameOf: (fen) => {
      const entry = data.names[toEpd(fen)];
      return entry ? { eco: entry[0] ?? '', name: entry[1] ?? '' } : null;
    },
  };
}

/** Coups « livre » : vrai jusqu'au premier coup qui sort de la base, faux ensuite. */
export function bookFlags(fensAfter: string[], index: OpeningIndex): boolean[] {
  let inBook = true;
  return fensAfter.map((fen) => (inBook = inBook && index.isBook(fen)));
}

/** Dernière position nommée avant de quitter la base. */
export function openingOf(fensAfter: string[], index: OpeningIndex): Opening | null {
  let found: Opening | null = null;
  for (const fen of fensAfter) {
    if (!index.isBook(fen)) break;
    found = index.nameOf(fen) ?? found;
  }
  return found;
}

let loaded: Promise<OpeningIndex> | undefined;

/** Charge la base à la demande (≈ 95 Ko compressés) pour alléger le premier affichage. */
export function loadOpeningIndex(): Promise<OpeningIndex> {
  loaded ??= import('../data/openings.json').then((module) =>
    createOpeningIndex(module.default as OpeningData),
  );
  return loaded;
}
