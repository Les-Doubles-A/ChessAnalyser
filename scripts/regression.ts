// Outils numériques de la calibration de l'Elo (T11), sans dépendance.

/** Résout A·x = b par élimination de Gauss avec pivot partiel. */
export function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) throw new Error('Système singulier');
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k++) a[row]![k]! -= factor * a[col]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k++) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

/**
 * Moindres carrés avec pénalité ridge `lambda` sur tous les coefficients sauf la
 * constante (première colonne), pour stabiliser les variables corrélées.
 */
export function fitRidge(rows: number[][], targets: number[], lambda: number): number[] {
  const k = rows[0]?.length ?? 0;
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  rows.forEach((x, n) => {
    for (let i = 0; i < k; i++) {
      xty[i]! += x[i]! * targets[n]!;
      for (let j = 0; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
    }
  });
  for (let i = 1; i < k; i++) xtx[i]![i]! += lambda;
  return solve(xtx, xty);
}

/** Quantile par interpolation linéaire sur des valeurs triées dans l'ordre croissant. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

export function median(values: readonly number[]): number {
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}
