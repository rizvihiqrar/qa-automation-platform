// Each mistake the AI's discount code made (docs/ai-written-code), as an edit that
// puts it back into today's code. run.mjs applies one at a time, runs every test,
// and records which techniques' tests fail. `find` must occur exactly once.
export const putBacks = [
  {
    id: 'CR-01',
    what: 'impossible dates accepted as expires_at (Date.parse rolls them over)',
    edits: [{ file: 'src/routes/discounts.ts', find: ' || !isRealDateTime(v)', replace: '' }],
  },
  {
    id: 'CR-02',
    what: 'a tolerance in the two-decimal check let in 10.000000000001',
    edits: [
      {
        file: 'src/routes/discounts.ts',
        find: "value <= 0 || !isWholeCents(value))",
        replace: 'value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) >= 1e-9)',
      },
      {
        file: 'src/routes/discounts.ts',
        find: 'min_subtotal < 0 || !isWholeCents(min_subtotal))',
        replace: 'min_subtotal < 0 || Math.abs(min_subtotal * 100 - Math.round(min_subtotal * 100)) >= 1e-9)',
      },
    ],
  },
  {
    id: 'CR-03',
    what: 'discount_code checked before the items, hiding their errors',
    edits: [{
      file: 'src/routes/orders.ts',
      find: "    return res.status(400).json({ error: 'items must be a non-empty array' });\n  }\n",
      replace: "    return res.status(400).json({ error: 'items must be a non-empty array' });\n  }\n"
        + "  if (discount_code !== null && (typeof discount_code !== 'string' || discount_code.trim() === '')) {\n"
        + "    return res.status(400).json({ error: 'discount_code must be a non-empty string or null' });\n  }\n",
    }],
  },
  {
    id: 'CR-04',
    what: 'a list as a PATCH body passed as "no changes" (200)',
    edits: [{
      file: 'src/routes/discounts.ts',
      find: "typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)",
      replace: 'false',
    }],
  },
  {
    id: 'CR-05',
    what: 'product prices not in whole cents (three at 0.333 came to 0.99)',
    edits: [{ file: 'src/routes/products.ts', find: 'return isWholeCents(price) ? price :', replace: 'return true ? price :' }],
  },
  {
    id: 'PM-01',
    what: 'no limit on an order, so a subtotal past 2^53 cents lost cents',
    edits: [{ file: 'src/routes/orders.ts', find: 'if (subtotalCents > MAX_ORDER_CENTS) {', replace: 'if (false) {' }],
  },
  {
    // The same check as CR-02, keeping only the half that refuses: whole-cent
    // amounts from 131,072.02 up whose n * 100 is more than 1e-9 off.
    id: 'PM-02',
    what: 'the same tolerance refused about 9% of valid amounts from 131,072.02 up',
    edits: [
      {
        file: 'src/routes/discounts.ts',
        find: "value <= 0 || !isWholeCents(value))",
        replace: 'value <= 0 || !isWholeCents(value) || Math.abs(value * 100 - Math.round(value * 100)) >= 1e-9)',
      },
      {
        file: 'src/routes/discounts.ts',
        find: 'min_subtotal < 0 || !isWholeCents(min_subtotal))',
        replace: 'min_subtotal < 0 || !isWholeCents(min_subtotal) || Math.abs(min_subtotal * 100 - Math.round(min_subtotal * 100)) >= 1e-9)',
      },
    ],
  },
];
