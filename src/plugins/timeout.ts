import { JenkinsPlugin } from './types';

/**
 * Plugin: Timeout (Jenkins built-in)
 *
 * Handles Jenkins DSL pattern:
 *   options { timeout(time: N, unit: 'UNIT') }  — stage-level or pipeline-level timeout
 *
 * Maps to Bitbucket Pipelines:
 *   max-time: <minutes>  — step-level timeout in minutes
 *
 * Unit conversion:
 *   SECONDS -> ceil(N / 60) minutes (minimum 1)
 *   MINUTES -> N minutes
 *   HOURS   -> N * 60 minutes
 *
 * Reference:
 *   Jenkins:    https://www.jenkins.io/doc/book/pipeline/syntax/#options
 *   Bitbucket:  https://support.atlassian.com/bitbucket-cloud/docs/configure-bitbucket-pipelinesyml/
 */
const timeoutPlugin: JenkinsPlugin = {
  name: 'timeout',

  detect(content: string): boolean {
    return /\btimeout\s*\(/.test(content);
  },

  detectInStage(stageContent: string): boolean {
    return /options\s*\{[^}]*\btimeout\s*\(/s.test(stageContent);
  },

  transformStageBody(body: string): string {
    return body;
  },

  getPrependLines(_isWindows: boolean): string[] {
    return [];
  },

  getMaxTime(stageContent: string): number | undefined {
    const m = stageContent.match(
      /\btimeout\s*\(\s*time\s*:\s*(\d+)\s*,\s*unit\s*:\s*['"](\w+)['"]\s*\)/
    );
    if (!m) return undefined;
    const value = parseInt(m[1], 10);
    if (value <= 0) return undefined;
    const unit = m[2].toUpperCase();
    switch (unit) {
      case 'SECONDS': return Math.max(1, Math.ceil(value / 60));
      case 'MINUTES': return Math.max(1, value);
      case 'HOURS':   return Math.max(1, value * 60);
      default:        return Math.max(1, value); // treat unknown units as minutes
    }
  },
};

export default timeoutPlugin;
