import { JenkinsPlugin } from './types';

/**
 * Plugin: Timestamper (https://plugins.jenkins.io/timestamper/)
 *
 * Handles two Jenkins DSL patterns:
 *   1. options { timestamps() }    — globally prepends a timestamp echo to every step
 *   2. timestamps { ... }          — wraps a stage body; prepends a timestamp echo to that step
 */
const timestamperPlugin: JenkinsPlugin = {
  name: 'timestamper',

  detect(content: string): boolean {
    return /options\s*\{[^}]*timestamps\s*\(\s*\)[^}]*\}/s.test(content);
  },

  detectInStage(stageContent: string): boolean {
    return /\btimestamps\s*\{/.test(stageContent);
  },

  transformStageBody(body: string): string {
    // Unwrap timestamps { ... } — keep the inner content, discard the wrapper
    return body.replace(/\btimestamps\s*\{([\s\S]*?)\}/g, (_match, inner) => inner);
  },

  getPrependLines(isWindows: boolean): string[] {
    const cmd = isWindows
      ? 'powershell -Command "Write-Host \'[TIMESTAMP]\' (Get-Date -Format \'yyyy-MM-ddTHH:mm:ssZ\')"'
      : "echo \"[TIMESTAMP] $(date -u '+%Y-%m-%dT%H:%M:%SZ')\"";
    return [cmd];
  },
};

export default timestamperPlugin;
