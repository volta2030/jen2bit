import { getBalancedBlock } from './utils';

export interface PostActions {
  always: string[];
  success: string[];
  failure: string[];
}

/**
 * Extracts shell commands from Jenkins post { always/success/failure } blocks.
 * @param blockContent - The stage or pipeline block content to search within.
 * @param isWindows - OS mode for command extraction.
 * @param convertStageBody - Function to extract commands from a block body.
 */
export function extractPostActions(
  blockContent: string,
  isWindows: boolean,
  convertStageBody: (body: string, isWindows: boolean) => string[]
): PostActions {
  const result: PostActions = { always: [], success: [], failure: [] };
  const postIdx = blockContent.search(/\bpost\s*\{/);
  if (postIdx < 0) return result;
  const postBlock = getBalancedBlock(blockContent, postIdx);
  if (!postBlock) return result;
  for (const [key, pattern] of [
    ['always',  /\balways\s*\{/],
    ['success', /\bsuccess\s*\{/],
    ['failure', /\bfailure\s*\{/],
  ] as Array<[keyof PostActions, RegExp]>) {
    const idx = postBlock.content.search(pattern);
    if (idx < 0) continue;
    const block = getBalancedBlock(postBlock.content, idx);
    if (block) result[key] = convertStageBody(block.content, isWindows);
  }
  return result;
}

/**
 * Strips the post { } block from blockContent so post commands don't leak into script:.
 */
export function stripPostBlock(blockContent: string): string {
  const postIdx = blockContent.search(/\bpost\s*\{/);
  if (postIdx < 0) return blockContent;
  const postBlock = getBalancedBlock(blockContent, postIdx);
  if (!postBlock) return blockContent;
  return blockContent.substring(0, postIdx) + blockContent.substring(postBlock.endIndex + 1);
}

/**
 * Emits after-script YAML lines for a step's post actions.
 * @param postActions - The post actions to emit.
 * @param lines - The output array to push lines into.
 * @param scriptIndent - The indentation used for script items (e.g. '          ').
 * @param isWindows - OS mode for exit code syntax.
 */
export function emitAfterScript(
  postActions: PostActions,
  lines: string[],
  scriptIndent: string,
  isWindows: boolean
): void {
  const hasAny =
    postActions.always.length > 0 ||
    postActions.success.length > 0 ||
    postActions.failure.length > 0;
  if (!hasAny) return;
  const keyIndent = scriptIndent.slice(0, -2);
  lines.push(`${keyIndent}after-script:`);
  for (const cmd of postActions.always) {
    lines.push(`${scriptIndent}- ${cmd}`);
  }
  if (isWindows) {
    for (const cmd of postActions.success) {
      lines.push(`${scriptIndent}- if ($env:BITBUCKET_EXIT_CODE -eq 0) { ${cmd} }`);
    }
    for (const cmd of postActions.failure) {
      lines.push(`${scriptIndent}- if ($env:BITBUCKET_EXIT_CODE -ne 0) { ${cmd} }`);
    }
  } else {
    for (const cmd of postActions.success) {
      lines.push(`${scriptIndent}- if [ $BITBUCKET_EXIT_CODE -eq 0 ]; then ${cmd}; fi`);
    }
    for (const cmd of postActions.failure) {
      lines.push(`${scriptIndent}- if [ $BITBUCKET_EXIT_CODE -ne 0 ]; then ${cmd}; fi`);
    }
  }
}
