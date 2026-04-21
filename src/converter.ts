import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { JENKINS_TO_BITBUCKET } from './env-map';

interface Stage {
  name: string;
  commands: string[];
  hasTimestampsWrapper: boolean;
}

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
  // Unwrap timestamps { ... } step wrapper — the block content is what matters
  body = body.replace(/\btimestamps\s*\{([\s\S]*?)\}/g, (_match, inner) => inner);

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
  const shPattern = /sh\s+["']([^"'\n]+)["']/g;
  for (const m of body.matchAll(shPattern)) {
    if (!isWindows) {
      allMatches.push({ index: m.index!, cmd: m[1] });
    } else {
      allMatches.push({
        index: m.index!,
        cmd: `# [skipped: sh is Linux-only] ${m[1]}`,
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

  allMatches.sort((a, b) => a.index - b.index);
  return allMatches.map((m) => mapEnvVars(m.cmd, isWindows));
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

  // Extract stages using balanced brace matching (single or double quotes)
  const stages: Stage[] = [];
  const stageHeaderPattern = /stage\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const hdr of content.matchAll(stageHeaderPattern)) {
    const stageName = hdr[1];
    const block = getBalancedBlock(content, hdr.index!);
    if (block) {
      const hasTimestampsWrapper = /\btimestamps\s*\{/.test(block.content);
      const commands = convertStageBody(block.content, isWindows);
      stages.push({ name: stageName, commands, hasTimestampsWrapper });
      logger.log(`Stage '${stageName}': ${commands.length} command(s) extracted`);
      for (const cmd of commands) {
        logger.log(`  -> ${cmd}`);
      }
    } else {
      logger.log(`Stage '${stageName}': failed to parse block`, 'WARN');
      stages.push({ name: stageName, commands: [], hasTimestampsWrapper: false });
    }
  }

  logger.log(`Stages found: ${stages.length}`);

  // Detect post actions
  const hasEmailNotify = /emailext\s*\(/.test(content);
  const hasPublishHTML = /publishHTML\s*\(/.test(content);

  // Detect branch / PR conditions in Jenkinsfile
  const hasBranchCondition = /when\s*\{[^}]*branch\s+["'][^"']+["'][^}]*\}/s.test(content);
  const hasPRCondition = /when\s*\{[^}]*changeRequest[^}]*\}/s.test(content);

  // Detect Jenkins options
  const hasTimestamps = /options\s*\{[^}]*timestamps\s*\(\s*\)[^}]*\}/s.test(content);
  if (hasTimestamps) {
    logger.log('Jenkins option detected: timestamps() -> adding timestamp echo to each step');
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

  // Timestamp echo command: printed at the start of each step's script when timestamps() is detected
  const tsEcho = isWindows
    ? 'powershell -Command "Write-Host \'[TIMESTAMP]\' (Get-Date -Format \'yyyy-MM-ddTHH:mm:ssZ\')"'
    : "echo \"[TIMESTAMP] $(date -u '+%Y-%m-%dT%H:%M:%SZ')\"";

  if (options.all) {
    // Merge all stages into a single step
    lines.push('    - step:');
    lines.push('        name: All Stages');
    if (runners) {
      lines.push('        runs-on:');
      for (const r of runners) {
        lines.push(`          - ${r}`);
      }
    }
    lines.push('        script:');

    for (const [key, val] of Object.entries(envVars)) {
      if (isWindows) {
        lines.push(`          - set ${key}=${val}`);
      } else {
        lines.push(`          - export ${key}=${val}`);
      }
    }

    if (hasTimestamps || stages.some((s) => s.hasTimestampsWrapper)) {
      lines.push(`          - ${tsEcho}`);
    }

    for (const stage of stages) {
      lines.push(`          - echo '--- Stage: ${stage.name} ---'`);
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
    }
    lines.push('');
  } else {
    for (const stage of stages) {
      lines.push('    - step:');
      lines.push(`        name: ${stage.name}`);
      if (runners) {
        lines.push('        runs-on:');
        for (const r of runners) {
          lines.push(`          - ${r}`);
        }
      }
      lines.push('        script:');

      for (const [key, val] of Object.entries(envVars)) {
        if (isWindows) {
          lines.push(`          - set ${key}=${val}`);
        } else {
          lines.push(`          - export ${key}=${val}`);
        }
      }

      if (hasTimestamps || stage.hasTimestampsWrapper) {
        lines.push(`          - ${tsEcho}`);
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
  }

  if (hasBranchCondition) {
    lines.push('  branches:');
    lines.push('    main:');
    lines.push('      - step:');
    lines.push('          name: Main Branch Build');
    lines.push('          script:');
    lines.push("            - echo 'Main branch pipeline'");
    lines.push('');
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
