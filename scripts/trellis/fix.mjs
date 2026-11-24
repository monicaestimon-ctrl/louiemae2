// fix.mjs <in> <out>: TRELLIS GLBs omit normals and metallicFactor (which then defaults to 1, fully metal).
// Adds smooth, area-weighted vertex normals, averaged across UV seams by position, keeping the mesh indexed.
import { NodeIO } from '@gltf-transform/core';
// ROT_Y=<degrees> turns a model that TRELLIS built facing away from +Z (the planner's front).
const [src, dst] = process.argv.slice(2);
const rot = (Number(process.env.ROT_Y) || 0) * Math.PI / 180;
const io = new NodeIO();
const doc = await io.read(src);
for (const m of doc.getRoot().listMaterials()) m.setMetallicFactor(0).setRoughnessFactor(0.85);
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray();
  if (rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let v = 0; v < pos.length; v += 3) { const x = pos[v], z = pos[v+2]; pos[v] = c*x + s*z; pos[v+2] = -s*x + c*z; }
    prim.getAttribute('POSITION').setArray(pos);
  }
  let idx2 = idx;
  const n = pos.length / 3, key = new Array(n), acc = new Map();
  for (let v = 0; v < n; v++) key[v] = `${Math.round(pos[3*v]*1e5)},${Math.round(pos[3*v+1]*1e5)},${Math.round(pos[3*v+2]*1e5)}`;
  for (let t = 0; t < idx2.length; t += 3) {
    const [a, b, c] = [idx2[t], idx2[t+1], idx2[t+2]];
    const ux = pos[3*b]-pos[3*a], uy = pos[3*b+1]-pos[3*a+1], uz = pos[3*b+2]-pos[3*a+2];
    const vx = pos[3*c]-pos[3*a], vy = pos[3*c+1]-pos[3*a+1], vz = pos[3*c+2]-pos[3*a+2];
    const f = [uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx];
    for (const v of [a, b, c]) { const s = acc.get(key[v]) || [0, 0, 0]; s[0] += f[0]; s[1] += f[1]; s[2] += f[2]; acc.set(key[v], s); }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { const s = acc.get(key[v]) || [0, 1, 0]; const l = Math.hypot(...s) || 1; out[3*v] = s[0]/l; out[3*v+1] = s[1]/l; out[3*v+2] = s[2]/l; }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
}
await io.write(dst, doc);
