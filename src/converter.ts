import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

interface Stage {
  name: string;
  commands: string[];
}

interface BalancedBlock {
  content: string;
  endIndex: number;
}

export interface ConvertOptions {
  input: string;
  output: string;
  runners?: string[];
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
 */
function convertStageBody(body: string): string[] {
  const allMatches: Array<{ index: number; cmd: string }> = [];

  // dir('path') { deleteDir() } -> if exist path rd /s /q path
  const dirDeletePattern =
    /dir\s*\(\s*'([^']+)'\s*\)\s*\{[^}]*deleteDir\s*\(\s*\)[^}]*\}/gs;
  for (const m of body.matchAll(dirDeletePattern)) {
    const dirPath = m[1].replace(/\//g, '\\');
    allMatches.push({
      index: m.index!,
      cmd: `if exist ${dirPath} rd /s /q ${dirPath}`,
    });
  }

  // dotnetBuild project: 'proj', optionsString: 'opts'
  const dotnetBuildPattern =
    /dotnetBuild\s+project:\s*'([^']+)'(?:\s*,\s*optionsString\s*:\s*'([^']*)')?/g;
  for (const m of body.matchAll(dotnetBuildPattern)) {
    const proj = m[1];
    const opts = m[2] ? ` ${m[2]}` : '';
    allMatches.push({ index: m.index!, cmd: `dotnet build ${proj}${opts}` });
  }

  // dotnetTest project: 'proj', optionsString: 'opts'
  const dotnetTestPattern =
    /dotnetTest\s+project:\s*'([^']+)'(?:\s*,\s*optionsString\s*:\s*'([^']*)')?/g;
  for (const m of body.matchAll(dotnetTestPattern)) {
    const proj = m[1];
    const opts = m[2] ? ` ${m[2]}` : '';
    allMatches.push({ index: m.index!, cmd: `dotnet test ${proj}${opts}` });
  }

  // bat 'command'
  const batPattern = /bat\s+'([^']+)'/g;
  for (const m of body.matchAll(batPattern)) {
    allMatches.push({ index: m.index!, cmd: m[1] });
  }

  // sh 'command' or sh "command"  (single line)
  const shPattern = /sh\s+["']([^"'\n]+)["']/g;
  for (const m of body.matchAll(shPattern)) {
    allMatches.push({ index: m.index!, cmd: m[1] });
  }

  // sh(""" ... """) or sh(''' ... ''')  (multi-line)
  const shMultiPattern =
    /sh\s*\(\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')\s*\)/g;
  for (const m of body.matchAll(shMultiPattern)) {
    const raw = (m[1] ?? m[2]).trim();
    let first = true;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        allMatches.push({
          index: first ? m.index! : m.index! + 1,
          cmd: trimmed,
        });
        first = false;
      }
    }
  }

  allMatches.sort((a, b) => a.index - b.index);
  return allMatches.map((m) => m.cmd);
}

/**
 * Converts a Jenkinsfile to a Bitbucket Pipelines YAML file.
 */
export function convert(options: ConvertOptions, logger: Logger): void {
  const startTime = new Date();
  logger.log('=== Conversion Started ===');

  const resolvedInput = path.resolve(options.input);
  const resolvedOutput = path.resolve(options.output);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Jenkinsfile not found at: ${resolvedInput}`);
  }

  const content = fs.readFileSync(resolvedInput, 'utf-8');
  logger.log(`Jenkinsfile loaded. Length: ${content.length} characters`);

  // Extract environment variables
  const envVars: Record<string, string> = {};
  const envMatch = content.match(/environment\s*\{([\s\S]*?)\}/);
  if (envMatch) {
    for (const m of envMatch[1].matchAll(/(\w+)\s*=\s*'([^']*)'/g)) {
      envVars[m[1]] = m[2];
    }
    logger.log(`Environment variables found: ${Object.keys(envVars).length}`);
  }

  // Extract agent label
  let agentLabel = '';
  const agentMatch = content.match(/label\s+'([^']+)'/);
  if (agentMatch) {
    agentLabel = agentMatch[1];
    logger.log(`Agent label: ${agentLabel}`);
  }

  // Extract stages using balanced brace matching
  const stages: Stage[] = [];
  const stageHeaderPattern = /stage\s*\(\s*'([^']+)'\s*\)/g;
  for (const hdr of content.matchAll(stageHeaderPattern)) {
    const stageName = hdr[1];
    const block = getBalancedBlock(content, hdr.index!);
    if (block) {
      const commands = convertStageBody(block.content);
      stages.push({ name: stageName, commands });
      logger.log(`Stage '${stageName}': ${commands.length} command(s) extracted`);
      for (const cmd of commands) {
        logger.log(`  -> ${cmd}`);
      }
    } else {
      logger.log(`Stage '${stageName}': failed to parse block`, 'WARN');
      stages.push({ name: stageName, commands: [] });
    }
  }

  logger.log(`Stages found: ${stages.length}`);

  // Detect post actions
  const hasEmailNotify = /emailext\s*\(/.test(content);
  const hasPublishHTML = /publishHTML\s*\(/.test(content);

  // Build YAML output
  const lines: string[] = [];
  const dateStr = startTime.toISOString().replace('T', ' ').slice(0, 19);

  const runners = options.runners && options.runners.length > 0
    ? options.runners
    : null;

  lines.push('# Auto-converted from Jenkinsfile');
  lines.push(`# Date: ${dateStr}`);
  lines.push(`# Original agent: ${agentLabel}`);
  lines.push('');

  if (runners) {
    lines.push(`# Runner: ${runners.join(', ')}`);
    lines.push('options:');
    lines.push('  default-runner:');
    for (const r of runners) {
      lines.push(`    - ${r}`);
    }
    lines.push('');
  }

  lines.push('pipelines:');
  lines.push('  default:');

  for (const stage of stages) {
    lines.push('    - step:');
    lines.push(`        name: ${stage.name}`);
    lines.push('        script:');

    for (const [key, val] of Object.entries(envVars)) {
      lines.push(`          - set ${key}=${val}`);
    }

    if (stage.commands.length > 0) {
      for (const cmd of stage.commands) {
        const cmdLines = cmd.split('\n');
        if (cmdLines.length === 1) {
          lines.push(`          - ${cmd}`);
        } else {
          lines.push('          - |');
          for (const line of cmdLines) {
            const trimmed = line.trim();
            if (trimmed) lines.push(`            ${trimmed}`);
          }
        }
      }
    } else {
      lines.push(`          - echo 'TODO: Add commands for ${stage.name}'`);
    }

    lines.push('');
  }

  lines.push('  branches:');
  lines.push('    main:');
  lines.push('      - step:');
  lines.push('          name: Main Branch Build');
  lines.push('          script:');
  lines.push("            - echo 'Main branch pipeline'");
  lines.push('');
  lines.push('  pull-requests:');
  lines.push("    '**':");
  lines.push('      - step:');
  lines.push('          name: PR Validation');
  lines.push('          script:');
  lines.push("            - echo 'PR validation pipeline'");
  lines.push('');

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
