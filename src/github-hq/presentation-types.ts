import type { TestModel } from '../dashboard-types.js';
import type { HQReading, HQTestSection } from './model.js';

export interface HomeTestCall { cardKey: string; answer: 'a' | 'b' | 'draw'; label: string; confirm: string }
export interface HomeTestRow {
  id: string; section: HQTestSection; title: string; lane: string; cells: string[]; status: string;
  model: TestModel | null; reading: HQReading | null; call: HomeTestCall | null;
  called: { cardKey: string; answer: 'a' | 'b' | 'draw' } | null; parkedUntil: string | null;
}
export interface HomeTests {
  mode: 'live'; readAt: string | null; readOk: boolean; rows: HomeTestRow[]; href: string;
}
