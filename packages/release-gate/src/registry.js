// The two registry calls build promotion needs, over the registry's HTTP API (the
// distribution API that Docker Hub, GitHub's container registry and registry:2 all speak):
// which digest a tag points to, and pointing another tag at a digest that is already there.
// A re-tag copies the manifest, byte for byte, so the digest cannot change.

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const url = (base, repo, ref) => `${base.replace(/\/$/, '')}/v2/${repo}/manifests/${ref}`;

/** The digest a tag (or digest) points to, or null when there is no such tag. */
export async function digestOf(base, repo, ref) {
  const res = await fetch(url(base, repo, ref), { method: 'HEAD', headers: { Accept: MANIFEST_TYPES } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`registry: HEAD ${repo}:${ref} answered ${res.status}`);
  const digest = res.headers.get('docker-content-digest');
  if (!digest) throw new Error(`registry: no digest header for ${repo}:${ref}`);
  return digest;
}

/** Points `tag` at the manifest with this digest, without building or pushing any layers. */
export async function retag(base, repo, digest, tag) {
  const got = await fetch(url(base, repo, digest), { headers: { Accept: MANIFEST_TYPES } });
  if (!got.ok) throw new Error(`registry: GET ${repo}@${digest} answered ${got.status}`);
  const type = got.headers.get('content-type');
  if (!type) throw new Error(`registry: no content type on the manifest ${digest}`);
  const body = Buffer.from(await got.arrayBuffer());
  const put = await fetch(url(base, repo, tag), { method: 'PUT', headers: { 'Content-Type': type }, body });
  if (put.status !== 201) throw new Error(`registry: PUT ${repo}:${tag} answered ${put.status}`);
}
