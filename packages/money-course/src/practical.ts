import { BUGS, startVariant } from './plant.ts';

// npm run practical: the banking API on http://localhost:4200 with all six bugs planted.
// It does not say which are planted or where; that is the practical (practical/brief.md).
const port = Number(process.env.PORT ?? 4200);
const { base } = await startVariant(BUGS.map((b) => b.id), { port });
console.log(`Practical API running on ${base.replace('127.0.0.1', 'localhost')} (in memory; each request waits 150 ms in an outside check).`);
console.log('It has six planted bugs, one for each objective. Read practical/brief.md, test it, then check yourself with practical/checklist.md and practical/model-answer.md.');
console.log('Stop it with Ctrl+C. Restarting gives a fresh, empty ledger.');
