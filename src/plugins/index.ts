import { JenkinsPlugin } from './types';
import timestamperPlugin from './timestamper';

/**
 * All registered Jenkins plugin converters.
 * The converter and inverter iterate this array to apply plugin logic.
 * Add new plugins here to extend conversion support.
 */
export const plugins: JenkinsPlugin[] = [
  timestamperPlugin,
];
