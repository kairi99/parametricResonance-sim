// Module Web Worker: protocol logic lives in resonance.js (createMessageHandler) so it is testable in Node.
import { createMessageHandler } from './resonance.js?v=8644c0b';

const handler = createMessageHandler((m) => self.postMessage(m));
self.onmessage = (e) => { handler(e.data); };
