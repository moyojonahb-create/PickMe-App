// Shared fuzzy-match scoring used to rank local search results (landmarks,
// streets) by relevance. Higher score = better match.
export const getFuzzyScore = (text: string, query: string): number => {
  if (!text || !query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match
  if (textLower === queryLower) return 100;

  // Starts with query
  if (textLower.startsWith(queryLower)) return 80;

  // Contains query as a word
  const words = textLower.split(/\s+/);
  if (words.some(w => w.startsWith(queryLower))) return 70;

  // Contains query anywhere
  if (textLower.includes(queryLower)) return 50;

  // Check each query word separately
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  const matchedWords = queryWords.filter(qw =>
    textLower.includes(qw) || words.some(w => w.startsWith(qw))
  );
  if (matchedWords.length > 0) {
    return 30 + (matchedWords.length / queryWords.length) * 20;
  }

  return 0;
};
