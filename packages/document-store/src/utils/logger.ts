/**
 * Centralized logging module with configurable log levels
 * Supports: DEBUG, INFO, WARN, ERROR
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private level: LogLevel;
  private name: string;

  constructor(name: string, level: LogLevel = LogLevel.DEBUG) {
    this.name = name;
    this.level = level;
  }

  setLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      const upperLevel = level.toUpperCase();
      switch (upperLevel) {
        case 'DEBUG':
          this.level = LogLevel.DEBUG;
          break;
        case 'INFO':
          this.level = LogLevel.INFO;
          break;
        case 'WARN':
        case 'WARNING':
          this.level = LogLevel.WARN;
          break;
        case 'ERROR':
          this.level = LogLevel.ERROR;
          break;
        default:
          throw new Error(`Invalid log level: ${level}`);
      }
    } else {
      this.level = level;
    }
  }

  getLevel(): LogLevel {
    return this.level;
  }

  getLevelName(): string {
    switch (this.level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
    }
  }

  private format(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.name}]`;
    
    if (args.length > 0) {
      const formattedArgs = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      return `${prefix} ${message} ${formattedArgs}`;
    }
    
    return `${prefix} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.error(this.format('DEBUG', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.error(this.format('INFO.', message, ...args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.error(this.format('WARN.', message, ...args));
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.format('ERROR', message, ...args));
    }
  }

  // Convenience method for logging objects
  logObject(level: 'debug' | 'info' | 'warn' | 'error', message: string, obj: any): void {
    const objStr = typeof obj === 'object' ? JSON.stringify(obj, null, 2) : String(obj);
    this[level](`${message}\n${objStr}`);
  }
}

// Global logger instance and level
let globalLogger: Logger | null = null;
let globalLogLevel: LogLevel = LogLevel.DEBUG;

export function initializeLogger(level: LogLevel | string = LogLevel.DEBUG): Logger {
  if (typeof level === 'string') {
    const upperLevel = level.toUpperCase();
    switch (upperLevel) {
      case 'DEBUG':
        globalLogLevel = LogLevel.DEBUG;
        break;
      case 'INFO':
        globalLogLevel = LogLevel.INFO;
        break;
      case 'WARN':
      case 'WARNING':
        globalLogLevel = LogLevel.WARN;
        break;
      case 'ERROR':
        globalLogLevel = LogLevel.ERROR;
        break;
      default:
        globalLogLevel = LogLevel.DEBUG;
    }
  } else {
    globalLogLevel = level;
  }
  
  globalLogger = new Logger('global', globalLogLevel);
  return globalLogger;
}

export function getLogger(name?: string): Logger {
  if (!globalLogger) {
    globalLogger = new Logger('global', LogLevel.DEBUG);
  }
  if (name) {
    // Create a new logger with the global log level
    const logger = new Logger(name, globalLogLevel);
    return logger;
  }
  return globalLogger;
}

export function setGlobalLogLevel(level: LogLevel | string): void {
  if (typeof level === 'string') {
    const upperLevel = level.toUpperCase();
    switch (upperLevel) {
      case 'DEBUG':
        globalLogLevel = LogLevel.DEBUG;
        break;
      case 'INFO':
        globalLogLevel = LogLevel.INFO;
        break;
      case 'WARN':
      case 'WARNING':
        globalLogLevel = LogLevel.WARN;
        break;
      case 'ERROR':
        globalLogLevel = LogLevel.ERROR;
        break;
    }
  } else {
    globalLogLevel = level;
  }
  
  if (!globalLogger) {
    initializeLogger(globalLogLevel);
  } else {
    globalLogger.setLevel(globalLogLevel);
  }
}
