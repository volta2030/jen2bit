import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { convert } from '../src/converter';
import { invert } from '../src/inverter';
import { Logger } from '../src/logger';

const JENKINSFILE = `
pipeline {
  agent { label 'swarm-ci' }
  environment {
    APP_ENV = 'staging'
  }
  stages {
    stage('Build') {
      steps {
        sh 'npm install'
        sh 'npm run build'
      }
    }
    stage('Test') {
      steps {
        sh 'npm test'
      }
    }
  }
}
`;

const BITBUCKET_YAML = `
pipelines:
  default:
    - step:
        name: Build
        script:
          - npm install
          - npm run build
    - step:
        name: Test
        script:
          - npm test
`;

interface BitbucketPipeline {
  pipelines?: {
    default?: Array<{ step?: { name?: string; script?: string[] } }>;
  };
}

function writeTmp(content: string, ext: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jen2bit-'));
  const file = path.join(dir, `input${ext}`);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('convert: Jenkinsfile -> bitbucket-pipelines.yml', () => {
  let output: string;
  let result: BitbucketPipeline;

  beforeAll(() => {
    const input = writeTmp(JENKINSFILE, '');
    output = path.join(path.dirname(input), 'bitbucket-pipelines.yml');
    convert({ input, output }, new Logger());
    result = yaml.load(fs.readFileSync(output, 'utf-8')) as BitbucketPipeline;
  });

  test('output file is created', () => {
    expect(fs.existsSync(output)).toBe(true);
  });

  test('outputs correct number of steps', () => {
    expect(result.pipelines?.default).toHaveLength(2);
  });

  test('stage names are preserved', () => {
    const names = result.pipelines!.default!.map((w) => w.step?.name);
    expect(names).toEqual(['Build', 'Test']);
  });

  test('stage scripts contain the original shell commands', () => {
    const build = result.pipelines!.default![0].step!;
    expect(build.script).toContain('npm install');
    expect(build.script).toContain('npm run build');

    const test = result.pipelines!.default![1].step!;
    expect(test.script).toContain('npm test');
  });

  test('output YAML contains auto-conversion header', () => {
    const content = fs.readFileSync(output, 'utf-8');
    expect(content).toContain('# Auto-converted from Jenkinsfile');
  });
});

describe('invert: bitbucket-pipelines.yml -> Jenkinsfile', () => {
  let output: string;
  let content: string;

  beforeAll(() => {
    const input = writeTmp(BITBUCKET_YAML, '.yml');
    output = path.join(path.dirname(input), 'Jenkinsfile');
    invert({ input, output }, new Logger());
    content = fs.readFileSync(output, 'utf-8');
  });

  test('output file is created', () => {
    expect(fs.existsSync(output)).toBe(true);
  });

  test('output contains pipeline block', () => {
    expect(content).toContain('pipeline {');
  });

  test('stage names are restored', () => {
    expect(content).toContain("stage('Build')");
    expect(content).toContain("stage('Test')");
  });

  test('stage scripts are restored as sh steps', () => {
    expect(content).toContain("sh 'npm install'");
    expect(content).toContain("sh 'npm run build'");
    expect(content).toContain("sh 'npm test'");
  });
});
