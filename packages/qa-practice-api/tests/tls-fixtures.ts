// Certificates made fresh for each run of tests/tls.spec.ts, in a temporary folder that is
// deleted afterwards: no key is ever written into the repository, so the secret scans stay
// clean and the expired certificate is expired by the clock, however long ago the repo was
// cloned. Needs the openssl program (on GitHub's Ubuntu runners, and in Git for Windows).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CertFiles {
  key: string;
  cert: string;
}

export interface Fixtures {
  dir: string;
  /** The certificate authority the good certificates are signed by (what a client must trust). */
  caCert: string;
  /** Signed by the CA, valid now, for localhost and 127.0.0.1. */
  valid: CertFiles;
  /** Signed by the CA and for localhost, but its dates ended two days ago. */
  expired: CertFiles;
  /** Signed by the CA and valid now, but for other.example only. */
  wrongHost: CertFiles;
  /** Signed by nobody but itself, for localhost. */
  selfSigned: CertFiles;
  remove: () => void;
}

const WINDOWS_GIT_OPENSSL = 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe';
const openssl = process.env.OPENSSL ?? (process.platform === 'win32' && existsSync(WINDOWS_GIT_OPENSSL) ? WINDOWS_GIT_OPENSSL : 'openssl');

function run(cwd: string, ...args: string[]): void {
  const res = spawnSync(openssl, args, { cwd, encoding: 'utf8' });
  if ((res.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error(`The certificate tests need the openssl program, and "${openssl}" was not found. Install it, or set OPENSSL to its full path.`);
  }
  if (res.error || res.status !== 0) {
    throw new Error(`openssl ${args.slice(0, 2).join(' ')} failed (${res.error?.message ?? res.status}): ${res.stderr}`);
  }
}

// OpenSSL's date format for `openssl ca`: YYYYMMDDHHMMSSZ.
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
const DAY = 86_400_000;

export function makeFixtures(): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), 'qa-tls-'));
  const at = (name: string) => join(dir, name);
  const fwd = dir.replaceAll('\\', '/');

  writeFileSync(at('index.txt'), '');
  writeFileSync(at('serial'), '1000\n');
  writeFileSync(at('ca.cnf'), `[ca]
default_ca = ca_default
[ca_default]
database = ${fwd}/index.txt
new_certs_dir = ${fwd}
serial = ${fwd}/serial
default_md = sha256
policy = any
unique_subject = no
[any]
commonName = supplied
`);
  const leafExt = (alt: string) => `[leaf]\nbasicConstraints = CA:FALSE\nsubjectAltName = ${alt}\n`;
  writeFileSync(at('local.ext'), leafExt('DNS:localhost,IP:127.0.0.1'));
  writeFileSync(at('other.ext'), leafExt('DNS:other.example'));

  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  run(dir, 'req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=qa-practice test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');

  const now = Date.now();
  const leaf = (name: string, ext: string, start: Date, end: Date): CertFiles => {
    run(dir, 'req', '-new', ...ec, '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`);
    run(dir, 'ca', '-batch', '-config', 'ca.cnf', '-cert', 'ca.crt', '-keyfile', 'ca.key', '-in', `${name}.csr`, '-out', `${name}.crt`,
      '-notext', '-startdate', stamp(start), '-enddate', stamp(end), '-extfile', ext, '-extensions', 'leaf');
    return { key: at(`${name}.key`), cert: at(`${name}.crt`) };
  };
  const valid = leaf('valid', 'local.ext', new Date(now - DAY), new Date(now + DAY));
  const expired = leaf('expired', 'local.ext', new Date(now - 3 * DAY), new Date(now - 2 * DAY));
  const wrongHost = leaf('wrong-host', 'other.ext', new Date(now - DAY), new Date(now + DAY));

  run(dir, 'req', '-x509', ...ec, '-keyout', 'self.key', '-out', 'self.crt', '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1');

  return {
    dir, caCert: at('ca.crt'), valid, expired, wrongHost,
    selfSigned: { key: at('self.key'), cert: at('self.crt') },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
