// Command TYPE → chip colour token (plan §1.3). Colour codes the type, never
// the command's status; an unmapped word is `other` rather than a guess, so
// STOP or an ABORT never borrows a run/end colour.

export type CommandKind = 'home' | 'move' | 'set' | 'wait' | 'loop' | 'end' | 'other';

const ALIAS = new Map<string, CommandKind>([
  ['home', 'home'], ['start', 'home'],
  ['move', 'move'], ['goto', 'move'], ['go', 'move'],
  ['set', 'set'], ['set out', 'set'], ['setpoint', 'set'], ['open', 'set'],
  ['wait', 'wait'], ['dwell', 'wait'],
  ['loop', 'loop'], ['repeat', 'loop'],
  ['end', 'end'],
]);

export function commandKind(raw: string): CommandKind {
  return ALIAS.get(raw.trim().toLowerCase()) ?? 'other';
}
