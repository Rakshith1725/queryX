export function detectRegression(originalCost, rewrittenCost, threshold = 0.05) {
  if (!originalCost || !rewrittenCost) {
    return { improved: null, deltaPct: null, verdict: 'unknown' };
  }

  const delta = originalCost - rewrittenCost;
  const deltaPct = parseFloat(((delta / originalCost) * 100).toFixed(2));

  let verdict;
  if (deltaPct > threshold * 100) {
    verdict = 'improvement';
  } else if (deltaPct < -(threshold * 100)) {
    verdict = 'regression';
  } else {
    verdict = 'neutral';
  }

  return {
    improved: verdict === 'improvement',
    deltaPct,
    verdict,
    originalCost,
    rewrittenCost,
  };
}