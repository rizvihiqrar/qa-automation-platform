import app from './app.ts';
import { seedAdmin } from './db/seed.ts';

const admin = await seedAdmin();
if (admin) console.log(`Admin account: ${admin.email}`);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`qa-practice-api running on http://localhost:${PORT}`));
