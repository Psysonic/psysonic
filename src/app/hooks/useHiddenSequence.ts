import { useEffect } from 'react';

const STATE_ATTRIBUTE = 'data-layout-state';
const COMMANDS = [
  { length: 17, hash: 3_373_202_901, active: true },
  { length: 5, hash: 1_819_600_217, active: false },
] as const;
const MAX_SEQUENCE_LENGTH = Math.max(...COMMANDS.map(command => command.length));

function hashSequence(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}

function setHiddenState(active: boolean): void {
  if (active) {
    document.documentElement.setAttribute(STATE_ATTRIBUTE, 'alternate');
  } else {
    document.documentElement.removeAttribute(STATE_ATTRIBUTE);
  }
}

export function useHiddenSequence(): void {
  useEffect(() => {
    let buffer = '';
    setHiddenState(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;

      buffer = `${buffer}${event.key.toLowerCase()}`.slice(-MAX_SEQUENCE_LENGTH);
      for (const command of COMMANDS) {
        if (buffer.length < command.length) continue;
        if (hashSequence(buffer.slice(-command.length)) !== command.hash) continue;
        setHiddenState(command.active);
        buffer = '';
        break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      setHiddenState(false);
    };
  }, []);
}
