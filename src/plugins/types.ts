/**
 * Interface that every Jenkins plugin converter must implement.
 * Each plugin is responsible for detecting its own presence,
 * transforming stage bodies, and producing the script lines it adds.
 */
export interface JenkinsPlugin {
  /** Unique plugin identifier */
  name: string;

  /** Return true if this plugin is globally active in the full Jenkinsfile content */
  detect(jenkinsfileContent: string): boolean;

  /** Return true if this plugin is active for a specific stage block */
  detectInStage(stageContent: string): boolean;

  /**
   * Transform a stage body string before command extraction.
   * Use this to unwrap DSL wrappers (e.g. timestamps { ... }).
   */
  transformStageBody(body: string): string;

  /**
   * Return the script lines this plugin contributes to the start of a step.
   * Only called when detect() or detectInStage() returned true for the step.
   */
  getPrependLines(isWindows: boolean): string[];
}
