export interface BalancedBlock {
  content: string;
  endIndex: number;
}

/**
 * Finds the content inside balanced braces starting from the first '{' at or after startIndex.
 */
export function getBalancedBlock(text: string, startIndex: number): BalancedBlock | null {
  const braceStart = text.indexOf('{', startIndex);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: text.substring(braceStart + 1, i),
          endIndex: i,
        };
      }
    }
  }
  return null;
}
