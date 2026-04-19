#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { convert } from './converter';
import { Logger } from './logger';

const program = new Command();

program
  .name('jen2bit')
  .description('Convert Jenkinsfile to Bitbucket Pipelines YAML')
  .version('0.1.0');

program
  .command('convert [jenkinsfile]')
  .description('Convert Jenkins file to Bitbucket Pipeline yml file')
  .option('-o, --output <file>', 'Output file path', 'bitbucket-pipelines.yml')
  .option('-r, --runner <runners...>', 'Runner labels for default-runner')
  .action((jenkinsfile: string = 'Jenkinsfile', options: { output: string; runner?: string[] }) => {
    const logger = new Logger();
    const inputPath = path.resolve(process.cwd(), jenkinsfile);
    const outputPath = path.resolve(process.cwd(), options.output);

    try {
      convert({ input: inputPath, output: outputPath, runners: options.runner }, logger);

      const logPath = path.resolve(process.cwd(), 'conversion.log');
      fs.writeFileSync(logPath, logger.getLines().join('\n') + '\n', 'utf-8');
      console.log(`\nLog saved to: ${logPath}`);
    } catch (err) {
      logger.log((err as Error).message, 'ERROR');
      process.exit(1);
    }
  });

program.parse(process.argv);
