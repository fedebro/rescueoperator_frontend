import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_PARTS, mergeMessages, type MessageTree } from '@/messages';

const dir = join(process.cwd(), 'src/messages');
const read = (file: string): MessageTree => JSON.parse(readFileSync(join(dir, file), 'utf8')) as MessageTree;

/** Synchronous merged message tree for tests (core file + every part). */
export function loadMessagesSync(locale: string): MessageTree {
  return MESSAGE_PARTS.reduce(
    (acc, part) => mergeMessages(acc, read(`parts/${locale}/${part}.json`)),
    read(`${locale}.json`),
  );
}
