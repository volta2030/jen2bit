/**
 * Bidirectional mapping between Jenkins built-in env vars and Bitbucket Pipelines equivalents.
 * Source: Jenkins Pipeline docs + Bitbucket Pipelines default variables docs.
 *
 * Empty string value means no Bitbucket equivalent exists.
 */
export const JENKINS_TO_BITBUCKET: Record<string, string> = {
  // Build identifiers
  BUILD_ID:           'BITBUCKET_BUILD_NUMBER',
  BUILD_NUMBER:       'BITBUCKET_BUILD_NUMBER',
  BUILD_TAG:          'BITBUCKET_BUILD_NUMBER',       // no direct equivalent — closest match

  // URLs / locations
  BUILD_URL:          'BITBUCKET_GIT_HTTP_ORIGIN',    // no direct equivalent — closest match
  JENKINS_URL:        'BITBUCKET_GIT_HTTP_ORIGIN',    // no direct equivalent — closest match
  WORKSPACE:          'BITBUCKET_CLONE_DIR',

  // Job / repo identity
  JOB_NAME:           'BITBUCKET_REPO_SLUG',

  // Git
  GIT_BRANCH:         'BITBUCKET_BRANCH',
  GIT_COMMIT:         'BITBUCKET_COMMIT',
  GIT_URL:            'BITBUCKET_GIT_HTTP_ORIGIN',

  // PR
  CHANGE_ID:          'BITBUCKET_PR_ID',
  CHANGE_TARGET:      'BITBUCKET_PR_DESTINATION_BRANCH',

  // No Bitbucket equivalent — left as comment
  EXECUTOR_NUMBER:    '',
  NODE_NAME:          '',
  JAVA_HOME:          '',
};

/**
 * Reverse map: Bitbucket env var -> Jenkins env var.
 * Built automatically from JENKINS_TO_BITBUCKET.
 * When multiple Jenkins vars map to the same Bitbucket var, the first one wins.
 */
export const BITBUCKET_TO_JENKINS: Record<string, string> = (() => {
  const reverse: Record<string, string> = {};
  for (const [jenkins, bitbucket] of Object.entries(JENKINS_TO_BITBUCKET)) {
    if (bitbucket && !(bitbucket in reverse)) {
      reverse[bitbucket] = jenkins;
    }
  }
  return reverse;
})();
