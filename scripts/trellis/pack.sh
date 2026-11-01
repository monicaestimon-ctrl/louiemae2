#!/bin/bash
# pack.sh <id>...: turn .trellis/raw/<id>.glb into public/trade/m/<id>.glb (1024px WebP texture) and
# <id>-low.glb (512px, ~35% of the triangles), Meshopt-compressed. Then add the id to CURATED_MODEL
# in trade/catalog.ts. Check the model first: it must face +Z with its width on X.
set -e
cd "$(dirname "$0")/../.."
# Tools install once into .trellis/tools (git-ignored); fix.mjs runs from there to resolve its import.
[ -d .trellis/tools/node_modules/@gltf-transform/cli ] || npm i --silent --prefix .trellis/tools @gltf-transform/cli@4 @gltf-transform/core@4
cp scripts/trellis/fix.mjs .trellis/tools/fix.mjs
GT=".trellis/tools/node_modules/.bin/gltf-transform"
mkdir -p public/trade/m
for i in "$@"; do
  node .trellis/tools/fix.mjs .trellis/raw/$i.glb .trellis/raw/$i.fix.glb
  $GT optimize .trellis/raw/$i.fix.glb public/trade/m/$i.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify false >/dev/null
  $GT optimize .trellis/raw/$i.fix.glb public/trade/m/$i-low.glb --compress meshopt --texture-compress webp --texture-size 512 --simplify true --simplify-ratio 0.35 --simplify-error 0.002 >/dev/null
  echo "$i $(stat -c%s public/trade/m/$i.glb) $(stat -c%s public/trade/m/$i-low.glb)"
done
