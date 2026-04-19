import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from './logger';
import { BITBUCKET_TO_JENKINS } from './env-map';

export interface InvertOptions {
  input: string;
  output: string;
}

interface BitbucketStep {
  name?: string;
  script?: string[];
}

interface BitbucketStepWrapper {
  step?: BitbucketStep;
}

interface BitbucketPipeline {
  options?: {
    'default-runner'?: string[];
  };
  pipelines?: {
    default?: BitbucketStepWrapper[];
    branches?: Record<string, BitbucketStepWrapper[]>;
    'pull-requests'?: Record<string, BitbucketStepWrapper[]>;
  };
}

/**
 * Converts a Bitbucket Pipelines command back to a Jenkins sh/bat step.
 * Reverses Bitbucket env vars to Jenkins ${env.VAR} references.
 * Skipped lines (comments starting with # [skipped:) are restored.
 */
function invertCommand(cmd: string, isWindows: boolean): string | null {
  // Restore skipped bat commands
  const batSkip = cmd.match(/^#\s*\[skipped: bat is Windows-only\]\s*(.+)$/);
  if (batSkip) return `bat '${batSkip[1]}'`;

  // Restore skipped sh commands
  const shSkip = cmd.match(/^#\s*\[skipped: sh is Linux-only\]\s*(.+)$/);
  if (shSkip) return `sh '${shSkip[1]}'`;

  // Skip "no Bitbucket equivalent" comments
  if (/^#\s*\[no Bitbucket equivalent/.test(cmd)) return null;

  // Skip auto-generated TODO comments
  if (/^echo 'TODO: Add commands/.test(cmd)) return null;

  // Reverse env var references
  cmd = reversEnvVars(cmd, isWindows);

  // Reverse Windows dir-delete: if exist path rd /s /q path -> dir('path') { deleteDir() }
  const rdMatch = cmd.match(/^if exist (.+?) rd \/s \/q .+$/);
  if (rdMatch) {
    const p = rdMatch[1].replace(/\\/g, '/');
    return `dir('${p}') { deleteDir() }`;
  }

  // Reverse Linux rm -rf: rm -rf path -> dir('path') { deleteDir() }
  const rmMatch = cmd.match(/^rm -rf (.+)$/);
  if (rmMatch) return `dir('${rmMatch[1]}') { deleteDir() }`;

  // Reverse set KEY=VALUE (Windows env) — skip, these come from Jenkins environment block
  if (/^set [A-Z_]+=/.test(cmd)) return null;

  // Reverse export KEY=VALUE (Linux env) — skip, these come from Jenkins environment block
  if (/^export [A-Z_]+=/.test(cmd)) return null;

  // Reverse dotnet build -> dotnetBuild
  const dotnetBuildMatch = cmd.match(/^dotnet build (.+?)(\s+--.+)?$/);
  if (dotnetBuildMatch) {
    const proj = dotnetBuildMatch[1].trim();
    const opts = dotnetBuildMatch[2]?.trim();
    return opts
      ? `dotnetBuild project: '${proj}', optionsString: '${opts}'`
      : `dotnetBuild project: '${proj}'`;
  }

  // Reverse dotnet test -> dotnetTest
  const dotnetTestMatch = cmd.match(/^dotnet test (.+?)(\s+--.+)?$/);
  if (dotnetTestMatch) {
    const proj = dotnetTestMatch[1].trim();
    const opts = dotnetTestMatch[2]?.trim();
    return opts
      ? `dotnetTest project: '${proj}', optionsString: '${opts}'`
      : `dotnetTest project: '${proj}'`;
  }

  // Default: wrap in sh or bat
  return isWindows ? `bat '${cmd}'` : `sh '${cmd}'`;
}

/**
 * Reverses Bitbucket env var references back to Jenkins ${env.VAR} syntax.
 * Windows: $env:BITBUCKET_VAR -> ${env.JENKINS_VAR}
 * Linux:   $BITBUCKET_VAR     -> ${env.JENKINS_VAR}
 */
function reversEnvVars(cmd: string, isWindows: boolean): string {
  if (isWindows) {
    // $env:BITBUCKET_VAR
    return cmd.replace(/\$env:([A-Z_]+)/g, (_match, bbVar) => {
      const jenkins = BITBUCKET_TO_JENKINS[bbVar];
      return jenkins ? `\${env.${jenkins}}` : `\${env.${bbVar}}`;
    });
  } else {
    // $BITBUCKET_VAR (only known Bitbucket vars, avoid false positives)
    return cmd.replace(/\$([A-Z_]{3,})/g, (_match, bbVar) => {
      const jenkins = BITBUCKET_TO_JENKINS[bbVar];
      return jenkins ? `\${env.${jenkins}}` : `\$${bbVar}`;
    });
  }
}

/**
 * Inverts a Bitbucket Pipelines YAML file back to a Jenkinsfile.
 */
export function invert(options: InvertOptions, logger: Logger): void {
  const startTime = new Date();
  logger.log('=== Inversion Started ===');

  const resolvedInput = path.resolve(options.input);
  const resolvedOutput = path.resolve(options.output);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`bitbucket-pipelines.yml not found at: ${resolvedInput}`);
  }

  const raw = fs.readFileSync(resolvedInput, 'utf-8');
  const parsed = yaml.load(raw) as BitbucketPipeline;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Failed to parse YAML file');
  }

  // Detect OS from options.default-runner
  const runners = parsed.options?.['default-runner'] ?? [];
  const isWindows = runners.some((r) => r.toLowerCase().includes('windows'));
  logger.log(`Target OS: ${isWindows ? 'windows' : 'linux'} (detected from default-runner)`);

  const defaultSteps = parsed.pipelines?.default ?? [];
  logger.log(`Default pipeline steps found: ${defaultSteps.length}`);

  // Build env vars from set/export commands
  const envVars: Record<string, string> = {};
  for (const wrapper of defaultSteps) {
    for (const cmd of wrapper.step?.script ?? []) {
      const setMatch = cmd.match(/^(?:set|export) ([A-Z_]+)=(.*)$/);
      if (setMatch) envVars[setMatch[1]] = setMatch[2];
    }
  }

  // Build Jenkinsfile lines
  const lines: string[] = [];
  const dateStr = startTime.toISOString().replace('T', ' ').slice(0, 19);

  lines.push('// Auto-inverted from bitbucket-pipelines.yml');
  lines.push(`// Date: ${dateStr}`);
  if (runners.length > 0) {
    lines.push(`// Original runners: ${runners.join(', ')}`);
  }
  lines.push('');
  lines.push('pipeline {');
  lines.push('  agent {');
  lines.push(`    label '${runners.join(' ') || 'any'}'`);
  lines.push('  }');

  // Emit environment block
  if (Object.keys(envVars).length > 0) {
    lines.push('');
    lines.push('  environment {');
    for (const [k, v] of Object.entries(envVars)) {
      lines.push(`    ${k} = '${v}'`);
    }
    lines.push('  }');
  }

  lines.push('');
  lines.push('  stages {');

  for (const wrapper of defaultSteps) {
    const step = wrapper.step;
    if (!step) continue;

    const stageName = step.name ?? 'Unnamed Stage';
    logger.log(`Processing stage: ${stageName}`);

    const scriptCmds = step.script ?? [];
    const jenkinsSteps: string[] = [];

    for (const cmd of scriptCmds) {
      const result = invertCommand(cmd, isWindows);
      if (result) {
        jenkinsSteps.push(result);
        logger.log(`  -> ${result}`);
      }
    }

    lines.push(`    stage('${stageName}') {`);
    lines.push('      steps {');
    lines.push('        script {');
    if (jenkinsSteps.length > 0) {
      for (const s of jenkinsSteps) {
        lines.push(`          ${s}`);
      }
    } else {
      lines.push(`          // TODO: Add steps for ${stageName}`);
    }
    lines.push('        }');
    lines.push('      }');
    lines.push('    }');
    lines.push('');
  }

  lines.push('  }');
  lines.push('}');

  fs.writeFileSync(resolvedOutput, lines.join('\n'), 'utf-8');
  logger.log('=== Inversion Completed Successfully ===', 'SUCCESS');
  logger.log(`Output file: ${resolvedOutput}`);
}
