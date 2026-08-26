export interface RidgeModel {
  weights: number[];
  lambda: number;
  mse: number;
}

export function trainRidge(features: number[][], labels: number[], lambda = 2.5): RidgeModel {
  if (!features.length || features.length !== labels.length) throw new Error("Ridge training data is empty or mismatched");
  const width = features[0]?.length ?? 0;
  if (!width || features.some((row) => row.length !== width)) throw new Error("Ridge feature widths are inconsistent");
  const matrix = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const target = Array.from({ length: width }, () => 0);
  for (let row = 0; row < features.length; row += 1) {
    const x = features[row] ?? [];
    const y = labels[row] ?? 0;
    for (let left = 0; left < width; left += 1) {
      target[left] = (target[left] ?? 0) + (x[left] ?? 0) * y;
      for (let right = 0; right < width; right += 1) matrix[left]![right] = (matrix[left]?.[right] ?? 0) + (x[left] ?? 0) * (x[right] ?? 0);
    }
  }
  for (let index = 1; index < width; index += 1) matrix[index]![index] = (matrix[index]?.[index] ?? 0) + lambda;
  const weights = solveLinearSystem(matrix, target);
  const mse = features.reduce((sum, row, index) => { const error = predictRidge(weights, row) - (labels[index] ?? 0); return sum + error * error; }, 0) / features.length;
  return { weights, lambda, mse };
}

export function predictRidge(weights: number[], features: number[]): number {
  return weights.reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0);
}

function solveLinearSystem(matrix: number[][], target: number[]): number[] {
  const size = target.length;
  const augmented = matrix.map((row, index) => [...row, target[index] ?? 0]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(augmented[row]?.[pivot] ?? 0) > Math.abs(augmented[best]?.[pivot] ?? 0)) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best] ?? [], augmented[pivot] ?? []];
    const divisor = augmented[pivot]?.[pivot] ?? 0;
    if (Math.abs(divisor) < 1e-10) continue;
    for (let column = pivot; column <= size; column += 1) augmented[pivot]![column] = (augmented[pivot]?.[column] ?? 0) / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]?.[pivot] ?? 0;
      if (!factor) continue;
      for (let column = pivot; column <= size; column += 1) augmented[row]![column] = (augmented[row]?.[column] ?? 0) - factor * (augmented[pivot]?.[column] ?? 0);
    }
  }
  return augmented.map((row) => row[size] ?? 0);
}
