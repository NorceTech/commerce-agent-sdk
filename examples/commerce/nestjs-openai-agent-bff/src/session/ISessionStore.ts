import { SessionState } from './sessionTypes.js';

export interface ISessionStore {
  get(key: string): Promise<SessionState | null>;
  set(key: string, state: SessionState): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  touch(key: string): Promise<boolean>;
}
