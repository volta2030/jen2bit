import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { JENKINS_TO_BITBUCKET } from './env-map';
import { plugins } from './plugins';

interface PostActions {
  always: string[];
  success: string[];
  failure: string[];
}

interface StepItem {
  kind: 'step';
  name: string;
  commands: string[];
  activePlugins: Set<string>;
  postActions: PostActions;
}

interface ParallelItem {
  kind: 'parallel';
  name: string;
  steps: StepItem[];
}

type PipelineItem = StepItem | ParallelItem;

interface BalancedBlock {
  content: string;
  endIndex: number;
}

export interface ConvertOptions {
  input: string;
  output: string;
  runners?: string[];
  all?: boolean;
}

/**
 * Mapping from Jenkins built-in env vars to Bitbucket Pipelines equivalents.
 * Source: Jenkins Pipeline docs + Bitbucket Pipelines default variables docs.
 */
const ENV_VAR_MAP = JENKINS_TO_BITBUCKET;

/**
 * Replaces Jenkins env var references in a command string with Bitbucket equivalents.
 * Handles: ${env.VAR}, $env.VAR, ${VAR}, $VAR (for known Jenkins built-ins).
 * Windows mode uses $env:VAR syntax, Linux uses $VAR.
 */
function mapEnvVars(cmd: string, isWindows: boolean): string {
  // Replace ${env.VAR_NAME} and $env.VAR_NAME
  cmd = cmd.replace(/\$\{env\.([A-Z_]+)\}|\$env\.([A-Z_]+)/g, (_match, v1, v2) => {
    const key = v1 ?? v2;
    return resolveEnvRef(key, isWindows);
  });

  // Replace ${VAR_NAME} for known Jenkins built-ins
  cmd = cmd.replace(/\$\{([A-Z_]+)\}/g, (_match, key) => {
    if (key in ENV_VAR_MAP) return resolveEnvRef(key, isWindows);
    return _match;
  });

  return cmd;
}

function resolveEnvRef(jenkinsVar: string, isWindows: boolean): string {
  const mapped = ENV_VAR_MAP[jenkinsVar];
  if (mapped === undefined) return isWindows ? `$env:${jenkinsVar}` : `$${jenkinsVar}`;
  if (mapped === '') return `# [no Bitbucket equivalent for ${jenkinsVar}]`;
  return isWindows ? `$env:${mapped}` : `$${mapped}`;
}

/**
 * Finds the content inside balanced braces starting from the first '{' at or after startIndex.
 */
function getBalancedBlock(text: string, startIndex: number): BalancedBlock | null {
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

/**
 * Extracts shell/batch commands from a Jenkins stage body block.
 * Supports: dir+deleteDir, dotnetBuild, dotnetTest, bat, sh (single & multi-line).
 * OS-aware: bat is Windows-only, sh is Linux-only, dir+deleteDir differs per OS.
 * isWindows is derived from runner labels: any label containing 'windows' -> Windows mode.
 */
function convertStageBody(body: string, isWindows: boolean): string[] {
  // Apply plugin body transformations (e.g. unwrap DSL wrappers)
  for (const plugin of plugins) {
    body = plugin.transformStageBody(body);
  }

  const allMatches: Array<{ index: number; cmd: string }> = [];

  // dir('path') or dir("path") { deleteDir() }
  // Windows: if exist path rd /s /q path
  // Linux:   rm -rf path
  const dirDeletePattern =
    /dir\s*\(\s*["']([^"']+)["']\s*\)\s*\{[^}]*deleteDir\s*\(\s*\)[^}]*\}/gs;
  for (const m of body.matchAll(dirDeletePattern)) {
    let cmd: string;
    if (isWindows) {
      const dirPath = m[1].replace(/\//g, '\\');
      cmd = `if exist ${dirPath} rd /s /q ${dirPath}`;
    } else {
      cmd = `rm -rf ${m[1]}`;
    }
    allMatches.push({ index: m.index!, cmd });
  }

  // dotnetBuild project: 'proj' or "proj", optionsString: 'opts' or "opts"
  const dotnetBuildPattern =
    /dotnetBuild\s+project:\s*["']([^"']+)["'](?:\s*,\s*optionsString\s*:\s*["']([^"']*)["'])?/g;
  for (const m of body.matchAll(dotnetBuildPattern)) {
    const proj = m[1];
    const opts = m[2] ? ` ${m[2]}` : '';
    allMatches.push({ index: m.index!, cmd: `dotnet build ${proj}${opts}` });
  }

  // dotnetTest project: 'proj' or "proj", optionsString: 'opts' or "opts"
  const dotnetTestPattern =
    /dotnetTest\s+project:\s*["']([^"']+)["'](?:\s*,\s*optionsString\s*:\s*["']([^"']*)["'])?/g;
  for (const m of body.matchAll(dotnetTestPattern)) {
    const proj = m[1];
    const opts = m[2] ? ` ${m[2]}` : '';
    allMatches.push({ index: m.index!, cmd: `dotnet test ${proj}${opts}` });
  }

  // bat 'command' or bat "command" — Windows CMD only
  const batPattern = /bat\s+["']([^"']+)["']/g;
  for (const m of body.matchAll(batPattern)) {
    if (isWindows) {
      allMatches.push({ index: m.index!, cmd: m[1] });
    } else {
      allMatches.push({
        index: m.index!,
        cmd: `# [skipped: bat is Windows-only] ${m[1]}`,
      });
    }
  }

  // sh 'command' or sh "command" (single line) — Linux/Unix only
  // Uses backreference to allow the opposite quote type inside the string.
  const shPattern = /sh\s+('([^'\n]*)'|"([^"\n]*)")/g;
  for (const m of body.matchAll(shPattern)) {
    const cmd = m[2] ?? m[3];
    if (!isWindows) {
      allMatches.push({ index: m.index!, cmd });
    } else {
      allMatches.push({
        index: m.index!,
        cmd: `# [skipped: sh is Linux-only] ${cmd}`,
      });
    }
  }

  // sh(""" ... """) or sh(''' ... ''')  (multi-line) — Linux/Unix only
  const shMultiPattern =
    /sh\s*\(\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')\s*\)/g;
  for (const m of body.matchAll(shMultiPattern)) {
    const raw = (m[1] ?? m[2]).trim();
    let first = true;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        if (!isWindows) {
          allMatches.push({
            index: first ? m.index! : m.index! + 1,
            cmd: trimmed,
          });
        } else {
          allMatches.push({
            index: first ? m.index! : m.index! + 1,
            cmd: `# [skipped: sh is Linux-only] ${trimmed}`,
          });
        }
        first = false;
      }
    }
  }

  // Jenkins echo 'text' or echo "text" — preserve original quote style.
  // Only match standalone echo steps outside other quoted DSL arguments.
  const extractStandaloneEchoMatches = (
    source: string
  ): Array<{ index: number; cmd: string }> => {
    const matches: Array<{ index: number; cmd: string }> = [];
    let inSingle = false;
    let inDouble = false;
    let escapeNext = false;
    let statementStart = true;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (inSingle) {
        if (ch === '\\') {
          escapeNext = true;
        } else if (ch === "'") {
          inSingle = false;
        }
        continue;
      }

      if (inDouble) {
        if (ch === '\\') {
          escapeNext = true;
        } else if (ch === '"') {
          inDouble = false;
        }
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        statementStart = false;
        continue;
      }

      if (ch === '"') {
        inDouble = true;
        statementStart = false;
        continue;
      }

      if (ch === '\n' || ch === ';' || ch === '{' || ch === '}') {
        statementStart = true;
        continue;
      }

      if (/\s/.test(ch)) {
        continue;
      }

      if (
        statementStart &&
        source.startsWith('echo', i) &&
        (i + 4 === source.length || /\s/.test(source[i + 4]))
      ) {
        let j = i + 4;
        while (j < source.length && /\s/.test(source[j])) j++;

        const quote = source[j];
        if (quote === "'" || quote === '"') {
          const contentStart = j + 1;
          let k = contentStart;
          let escaped = false;

          while (k < source.length) {
            const current = source[k];
            if (escaped) {
              escaped = false;
            } else if (current === '\\') {
              escaped = true;
            } else if (current === quote) {
              matches.push({
                index: i,
                cmd: `echo ${quote}${source.slice(contentStart, k)}${quote}`,
              });
              i = k;
              break;
            }
            k++;
          }
        }

        statementStart = false;
        continue;
      }

      statementStart = false;
    }

    return matches;
  };

  for (const m of extractStandaloneEchoMatches(body)) {
    allMatches.push(m);
  }

  allMatches.sort((a, b) => a.index - b.index);
  return allMatches.map((m) => mapEnvVars(m.cmd, isWindows));
}

/**
 * Extracts shell commands from Jenkins post { always/success/failure } blocks.
 */
function extractPostActions(blockContent: string, isWindows: boolean): PostActions {
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
 * Returns the direct child stage name+block pairs within a stages/parallel body.
 * Only matches stage() declarations at depth 0 of the given body string.
 */
function findDirectChildStages(
  body: string
): Array<{ name: string; blockContent: string }> {
  const results: Array<{ name: string; blockContent: string }> = [];
  const pattern = /stage\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const m of body.matchAll(pattern)) {
    // Count brace depth at this match position
    let depth = 0;
    for (let i = 0; i < m.index!; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
    }
    if (depth === 0) {
      const block = getBalancedBlock(body, m.index!);
      if (block) results.push({ name: m[1], blockContent: block.content });
    }
  }
  return results;
}

/**
 * Builds a StepItem from a stage name and its block content.
 */
function buildStep(
  name: string,
  blockContent: string,
  isWindows: boolean,
  logger: Logger
): StepItem {
  const activePlugins = new Set(
    plugins.filter((p) => p.detectInStage(blockContent)).map((p) => p.name)
  );
  const postActions = extractPostActions(blockContent, isWindows);
  // Strip post block before extracting commands so post commands don't leak into script:
  const postIdx = blockContent.search(/\bpost\s*\{/);
  let bodyForCommands = blockContent;
  if (postIdx >= 0) {
    const postBlock = getBalancedBlock(blockContent, postIdx);
    if (postBlock) {
      bodyForCommands = blockContent.substring(0, postIdx) + blockContent.substring(postBlock.endIndex + 1);
    }
  }
  const commands = convertStageBody(bodyForCommands, isWindows);
  logger.log(`Stage '${name}': ${commands.length} command(s) extracted`);
  for (const cmd of commands) logger.log(`  -> ${cmd}`);
  return { kind: 'step', name, commands, activePlugins, postActions };
}

/**
 * Converts a Jenkinsfile to a Bitbucket Pipelines YAML file.
 */
export function convert(options: ConvertOptions, logger: Logger): void {
  const startTime = new Date();
  // Determine OS from runner labels: any label containing 'windows' -> Windows mode, otherwise Linux
  const isWindows = options.runners
    ? options.runners.some((r) => r.toLowerCase().includes('windows'))
    : false; // default: Linux when no runner specified
  logger.log('=== Conversion Started ===');
  logger.log(`Target OS: ${isWindows ? 'windows' : 'linux'} (detected from runner labels)`);

  const resolvedInput = path.resolve(options.input);
  const resolvedOutput = path.resolve(options.output);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Jenkinsfile not found at: ${resolvedInput}`);
  }

  const content = fs.readFileSync(resolvedInput, 'utf-8');
  logger.log(`Jenkinsfile loaded. Length: ${content.length} characters`);

  // Extract environment variables (single or double quotes, skip credentials() calls)
  const envVars: Record<string, string> = {};
  const envMatch = content.match(/environment\s*\{([\s\S]*?)\}/);
  if (envMatch) {
    for (const m of envMatch[1].matchAll(/(\w+)\s*=\s*["']([^"']*)["']/g)) {
      envVars[m[1]] = m[2];
    }
    logger.log(`Environment variables found: ${Object.keys(envVars).length}`);
  }

  // Extract agent label (single or double quotes)
  let agentLabel = '';
  const agentMatch = content.match(/label\s+["']([^"']+)["']/);
  if (agentMatch) {
    agentLabel = agentMatch[1];
    logger.log(`Agent label: ${agentLabel}`);
  }

  // Extract top-level stages from within the main stages {} block
  const items: PipelineItem[] = [];
  const stagesBlockMatch = content.search(/\bstages\s*\{/);
  const stagesBlock = stagesBlockMatch >= 0 ? getBalancedBlock(content, stagesBlockMatch) : null;

  if (stagesBlock) {
    for (const { name, blockContent } of findDirectChildStages(stagesBlock.content)) {
      // Check if this stage contains a parallel {} block
      const parallelIdx = blockContent.search(/\bparallel\s*\{/);
      if (parallelIdx >= 0) {
        const parallelBlock = getBalancedBlock(blockContent, parallelIdx);
        if (parallelBlock) {
          const parallelChildren = findDirectChildStages(parallelBlock.content);
          const childSteps = parallelChildren.map(({ name: cName, blockContent: cBody }) =>
            buildStep(cName, cBody, isWindows, logger)
          );
          logger.log(`Stage '${name}': parallel with ${childSteps.length} sub-stage(s)`);
          items.push({ kind: 'parallel', name, steps: childSteps });
          continue;
        }
      }
      items.push(buildStep(name, blockContent, isWindows, logger));
    }
  } else {
    logger.log('Could not locate stages {} block', 'WARN');
  }

  logger.log(`Stages found: ${items.length}`);

  // Detect post actions
  const hasEmailNotify = /emailext\s*\(|mail\s+to\s*:/.test(content);
  const hasPublishHTML = /publishHTML\s*\(/.test(content);

  // Extract pipeline-level post block (outside the stages block)
  let pipelinePostActions: PostActions = { always: [], success: [], failure: [] };
  if (stagesBlock) {
    const afterStages = content.substring(stagesBlock.endIndex + 1);
    if (/\bpost\s*\{/.test(afterStages)) {
      pipelinePostActions = extractPostActions(afterStages, isWindows);
      const hasPipelinePost =
        pipelinePostActions.always.length > 0 ||
        pipelinePostActions.success.length > 0 ||
        pipelinePostActions.failure.length > 0;
      if (hasPipelinePost) logger.log('Pipeline-level post block detected');
    }
  }

  // Convert pipeline-level post into a dedicated "Post" step appended to items.
  // always -> script:, success/failure -> after-script: with $BITBUCKET_EXIT_CODE conditions.
  const hasPipelinePost =
    pipelinePostActions.always.length > 0 ||
    pipelinePostActions.success.length > 0 ||
    pipelinePostActions.failure.length > 0;
  if (hasPipelinePost) {
    const postStep: StepItem = {
      kind: 'step',
      name: 'Post',
      commands: pipelinePostActions.always,
      activePlugins: new Set(),
      postActions: {
        always: [],
        success: pipelinePostActions.success,
        failure: pipelinePostActions.failure,
      },
    };
    items.push(postStep);
    logger.log("Pipeline-level post block -> added as 'Post' step");
  }

  // Detect branch / PR conditions in Jenkinsfile
  const branchConditionRegex = /when\s*\{[^}]*branch\s+["']([^"']+)["'][^}]*\}/gs;
  const branchNameSet = new Set<string>();
  let branchMatch: RegExpExecArray | null;
  while ((branchMatch = branchConditionRegex.exec(content)) !== null) {
    branchNameSet.add(branchMatch[1]);
  }
  const branchNames = Array.from(branchNameSet);
  const hasBranchCondition = branchNames.length > 0;
  const hasPRCondition = /when\s*\{[^}]*changeRequest[^}]*\}/s.test(content);

  // Detect globally active plugins
  const globalPlugins = new Set(
    plugins.filter((p) => p.detect(content)).map((p) => p.name)
  );
  for (const name of globalPlugins) {
    logger.log(`Jenkins plugin detected: ${name} -> prepending script lines to each step`);
  }

  // Helper: emit script lines for a single StepItem
  function emitStepScript(step: StepItem, indent: string): void {
    for (const [key, val] of Object.entries(envVars)) {
      lines.push(`${indent}- ${isWindows ? 'set' : 'export'} ${key}=${val}`);
    }
    for (const plugin of plugins) {
      if (globalPlugins.has(plugin.name) || step.activePlugins.has(plugin.name)) {
        for (const l of plugin.getPrependLines(isWindows)) lines.push(`${indent}- ${l}`);
      }
    }
    if (step.commands.length > 0) {
      for (const cmd of step.commands) {
        const cmdLines = cmd.split('\n');
        if (cmdLines.length === 1) {
          lines.push(`${indent}- ${cmd}`);
        } else {
          lines.push(`${indent}- |`);
          for (const l of cmdLines) {
            const t = l.trim();
            if (t) lines.push(`${indent}  ${t}`);
          }
        }
      }
    } else {
      lines.push(`${indent}- echo 'TODO: Add commands for ${step.name}'`);
    }
  }

  // Helper: emit after-script for a StepItem's post actions
  function emitAfterScript(postActions: PostActions, scriptIndent: string): void {
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

  // Build YAML output
  const lines: string[] = [];
  const dateStr = startTime.toISOString().replace('T', ' ').slice(0, 19);

  const runners = options.runners && options.runners.length > 0
    ? options.runners
    : null;

  lines.push('# Auto-converted from Jenkinsfile');
  lines.push(`# Date: ${dateStr}`);
  lines.push(`# Original agent: ${agentLabel}`);
  lines.push(`# Target OS: ${isWindows ? 'windows' : 'linux'}`);
  lines.push('');

  lines.push('pipelines:');
  lines.push('  default:');

  // Collect all StepItems (flattened, for --all mode and plugin detection)
  const allSteps: StepItem[] = items.flatMap((item) =>
    item.kind === 'parallel' ? item.steps : [item]
  );

  if (options.all) {
    // Merge all stages into a single step (flatten parallel)
    lines.push('    - step:');
    lines.push('        name: All Stages');
    if (runners) {
      lines.push('        runs-on:');
      for (const r of runners) lines.push(`          - ${r}`);
    }
    lines.push('        script:');

    for (const [key, val] of Object.entries(envVars)) {
      lines.push(`          - ${isWindows ? 'set' : 'export'} ${key}=${val}`);
    }

    for (const plugin of plugins) {
      const active = globalPlugins.has(plugin.name) || allSteps.some((s) => s.activePlugins.has(plugin.name));
      if (active) {
        for (const l of plugin.getPrependLines(isWindows)) lines.push(`          - ${l}`);
      }
    }

    for (const step of allSteps) {
      lines.push(`          - echo '--- Stage: ${step.name} ---'`);
      for (const cmd of step.commands) {
        const cmdLines = cmd.split('\n');
        if (cmdLines.length === 1) {
          lines.push(`          - ${cmd}`);
        } else {
          lines.push('          - |');
          for (const l of cmdLines) {
            const t = l.trim();
            if (t) lines.push(`            ${t}`);
          }
        }
      }
      if (step.commands.length === 0) {
        lines.push(`          - echo 'TODO: Add commands for ${step.name}'`);
      }
    }
    lines.push('');
  } else {
    for (const item of items) {
      if (item.kind === 'parallel') {
        lines.push('    - parallel:');
        for (const step of item.steps) {
          lines.push('        - step:');
          lines.push(`            name: ${step.name}`);
          if (runners) {
            lines.push('            runs-on:');
            for (const r of runners) lines.push(`              - ${r}`);
          }
          lines.push('            script:');
          emitStepScript(step, '              ');
          emitAfterScript(step.postActions, '              ');
        }
        lines.push('');
      } else {
        lines.push('    - step:');
        lines.push(`        name: ${item.name}`);
        if (runners) {
          lines.push('        runs-on:');
          for (const r of runners) lines.push(`          - ${r}`);
        }
        lines.push('        script:');
        emitStepScript(item, '          ');
        emitAfterScript(item.postActions, '          ');
        lines.push('');
      }
    }
  }

  if (hasBranchCondition) {
    lines.push('  branches:');
    for (const branch of branchNames) {
      lines.push(`    ${branch}:`);
      lines.push('      - step:');
      lines.push(`          name: ${branch} Branch Build`);
      lines.push('          script:');
      lines.push(`            - echo '${branch} branch pipeline'`);
      lines.push('');
    }
  }

  if (hasPRCondition) {
    lines.push('  pull-requests:');
    lines.push("    '**':");
    lines.push('      - step:');
    lines.push('          name: PR Validation');
    lines.push('          script:');
    lines.push("            - echo 'PR validation pipeline'");
    lines.push('');
  }

  if (hasEmailNotify || hasPublishHTML) {
    lines.push('# =============================================================');
    lines.push('# Post-action migration notes (from Jenkinsfile post block):');
    if (hasEmailNotify) {
      lines.push(
        '# - Email notification: Configure in Bitbucket repository settings'
      );
      lines.push('#   Settings > Pipelines > Notifications');
    }
    if (hasPublishHTML) {
      lines.push(
        "# - HTML report publishing: Use Bitbucket artifacts instead"
      );
      lines.push("#   Add 'artifacts:' section to the Coverage Report step:");
      lines.push('#     artifacts:');
      lines.push('#       - CoverageReport/**');
    }
    lines.push('# =============================================================');
  }

  fs.writeFileSync(resolvedOutput, lines.join('\n'), 'utf-8');
  logger.log('=== Conversion Completed Successfully ===', 'SUCCESS');
  logger.log(`Output file: ${resolvedOutput}`);
}
