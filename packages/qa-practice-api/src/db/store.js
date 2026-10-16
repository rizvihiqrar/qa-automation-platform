class Table {
  #rows = new Map();
  #nextId = 1;

  insert(record) {
    const id  = this.#nextId++;
    const row = { id, created_at: new Date().toISOString(), ...record };
    this.#rows.set(id, { ...row });
    return { ...row };
  }

  findById(id) {
    const row = this.#rows.get(parseInt(id));
    return row ? { ...row } : null;
  }

  findOne(filter) {
    for (const row of this.#rows.values()) {
      if (matches(row, filter)) return { ...row };
    }
    return null;
  }

  findAll(filter = {}, { page = 1, limit = 10 } = {}) {
    let rows  = [...this.#rows.values()].filter(r => matches(r, filter));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    rows = rows.slice((page - 1) * limit, page * limit);
    return { data: rows.map(r => ({ ...r })), total, pages };
  }

  update(id, changes) {
    const row = this.#rows.get(parseInt(id));
    if (!row) return null;
    const updated = { ...row };
    for (const [k, v] of Object.entries(changes)) {
      if (v !== undefined) updated[k] = v;
    }
    this.#rows.set(parseInt(id), updated);
    return { ...updated };
  }

  delete(id) {
    return this.#rows.delete(parseInt(id));
  }
}

function matches(row, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (row[k] !== v) return false;
  }
  return true;
}

export const users    = new Table();
export const products = new Table();
export const orders   = new Table();
