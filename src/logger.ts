export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export class Logger {
  private lines: string[] = [];

  log(message: string, level: LogLevel = 'INFO'): void {
    const entry = `[${level}] ${message}`;
    this.lines.push(entry);
    console.log(entry);
  }

  getLines(): string[] {
    return [...this.lines];
  }
}
