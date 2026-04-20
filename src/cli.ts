#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { convert } from './converter';
import { invert } from './inverter';
import { Logger } from './logger';

const { version } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('jen2bit')
  .description('Convert Jenkinsfile to Bitbucket Pipelines YAML')
  .version(version);

program
  .command('convert [jenkinsfile]')
  .description('Convert Jenkins file to Bitbucket Pipeline yml file')
  .option('-o, --output <file>', 'Output file path', 'bitbucket-pipelines.yml')
  .option('-r, --runner <runners...>', 'Runner labels for generated runs-on entries in each step')
  .option('-a, --all', 'Merge all stages into a single step')
  .action((jenkinsfile: string = 'Jenkinsfile', options: { output: string; runner?: string[]; all?: boolean }) => {
    const logger = new Logger();
    const inputPath = path.resolve(process.cwd(), jenkinsfile);
    const outputPath = path.resolve(process.cwd(), options.output);

    try {
      convert({ input: inputPath, output: outputPath, runners: options.runner, all: options.all }, logger);

      const logPath = path.resolve(process.cwd(), 'conversion.log');
      fs.writeFileSync(logPath, logger.getLines().join('\n') + '\n', 'utf-8');
      console.log(`\nLog saved to: ${logPath}`);
    } catch (err) {
      logger.log((err as Error).message, 'ERROR');
      process.exit(1);
    }
  });

program
  .command('invert [bitbucket-pipelines]')
  .description('Invert bitbucket-pipelines.yml to Jenkinsfile')
  .option('-o, --output <file>', 'Output file path', 'Jenkinsfile')
  .action((input: string = 'bitbucket-pipelines.yml', options: { output: string }) => {
    const logger = new Logger();
    const inputPath = path.resolve(process.cwd(), input);
    const outputPath = path.resolve(process.cwd(), options.output);

    try {
      invert({ input: inputPath, output: outputPath }, logger);

      const logPath = path.resolve(process.cwd(), 'inversion.log');
      fs.writeFileSync(logPath, logger.getLines().join('\n') + '\n', 'utf-8');
      console.log(`\nLog saved to: ${logPath}`);
    } catch (err) {
      logger.log((err as Error).message, 'ERROR');
      process.exit(1);
    }
  });

program.parse(process.argv);
