"""Seamless cutouts for House products, step 1 of 2: make candidates for review.

    pip install "rembg[cpu]"
    CONVEX_DEPLOY_KEY=<production deploy key> python3 scripts/cutouts/make.py [--limit 25]

Reads the published House products that have no approved cutout (holmAssets:cutoutQueue), skips the
24 curated pieces (they ship studio cutouts, see trade/curatedSources.ts), and for each product cuts
the background out of up to three of its photos with ISNet (rembg "isnet-general-use", CPU, ~1 s a
photo). Stray specks are dropped and each cutout is cropped to the piece. Output goes to .cutouts/
(git-ignored): <productId>/<k>.png per candidate, queue.json, and sheet-N.png contact sheets that
show every candidate on a checkerboard, labelled "<row>.<k>".

Look at every candidate, then save the good ones with scripts/cutouts/upload.py.
"""
import io, json, os, re, subprocess, sys, urllib.request

from PIL import Image, ImageDraw
from rembg import new_session, remove

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, ".cutouts")
MAX_SIDE = 1600   # cutouts are drawn on boards and in rooms, never larger than this
CANDIDATES = 3    # photos tried per product
PER_SHEET = 8


def convex(fn, args="{}"):
    r = subprocess.run(["npx", "convex", "run", fn, args], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def curated_ids():
    src = open(os.path.join(ROOT, "trade", "curatedSources.ts")).read()
    return set(re.findall(r"'([a-z0-9]{32})':", src))


def clean(cut):
    """Drop disconnected specks (under 2% of the largest piece), then crop to what is left."""
    a = cut.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    w, h = a.size
    small = a.resize((max(1, w // 4), max(1, h // 4)))
    px = small.load(); sw, sh = small.size
    seen = [[0] * sw for _ in range(sh)]; parts = []
    for y in range(sh):
        for x in range(sw):
            if px[x, y] and not seen[y][x]:
                stack = [(x, y)]; seen[y][x] = 1; pts = []
                while stack:
                    cx, cy = stack.pop(); pts.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < sw and 0 <= ny < sh and px[nx, ny] and not seen[ny][nx]:
                            seen[ny][nx] = 1; stack.append((nx, ny))
                parts.append(pts)
    if not parts:
        return None
    big = max(len(p) for p in parts)
    mask = Image.new("L", small.size, 0); mp = mask.load()
    for p in parts:
        if len(p) >= 0.02 * big:
            for x, y in p:
                mp[x, y] = 255
    mask = mask.resize((w, h))
    alpha = Image.composite(cut.getchannel("A"), Image.new("L", (w, h), 0), mask)
    cut.putalpha(alpha)
    box = alpha.getbbox()
    if not box:
        return None
    cut = cut.crop(box)
    cut.thumbnail((MAX_SIDE, MAX_SIDE))
    return cut


def checker(w, h):
    c = Image.new("RGB", (w, h), "#ffffff"); d = ImageDraw.Draw(c)
    for y in range(0, h, 16):
        for x in range(0, w, 16):
            if (x // 16 + y // 16) % 2:
                d.rectangle([x, y, x + 15, y + 15], fill="#e4e4e4")
    return c


def sheets(rows):
    S = 300
    for n in range(0, len(rows), PER_SHEET):
        part = rows[n:n + PER_SHEET]
        img = Image.new("RGB", (S * (CANDIDATES + 1) + 50, (S + 30) * len(part)), "#fbf8f2"); d = ImageDraw.Draw(img)
        for r, row in enumerate(part):
            y = r * (S + 30)
            d.text((10, y + 8), f"{n + r + 1}. {row['name'][:90]}", fill="#2b211a")
            src = Image.open(os.path.join(OUT, row["productId"], "0.jpg")).convert("RGB"); src.thumbnail((S, S))
            img.paste(src, (10, y + 26))
            for k in row["candidates"]:
                cut = Image.open(os.path.join(OUT, row["productId"], f"{k}.png")); cut.thumbnail((S, S))
                bg = checker(S, S); bg.paste(cut, ((S - cut.width) // 2, (S - cut.height) // 2), cut)
                x = (k + 1) * (S + 10) + 10
                img.paste(bg, (x, y + 26)); d.text((x + 4, y + 30), f"{n + r + 1}.{k}", fill="#b0372b")
        path = os.path.join(OUT, f"sheet-{n // PER_SHEET + 1}.png"); img.save(path); print("sheet", path)


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 25
    os.makedirs(OUT, exist_ok=True)
    skip = curated_ids()
    queue = [p for p in convex("holmAssets:cutoutQueue") if p["productId"] not in skip]
    print(f"{len(queue)} products without an approved cutout (curated pieces excluded); making {min(limit, len(queue))}")
    session = new_session("isnet-general-use")
    rows = []
    for p in queue[:limit]:
        d = os.path.join(OUT, p["productId"]); os.makedirs(d, exist_ok=True); cands = []
        for k, url in enumerate(p["images"][:CANDIDATES]):
            try:
                im = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert("RGB")
            except Exception as e:  # noqa: BLE001 - one bad photo must not stop the batch
                print("  photo failed", p["productId"], k, e); continue
            if k == 0:
                im.save(os.path.join(d, "0.jpg"), quality=88)
            cut = clean(remove(im, session=session))
            if cut is not None:
                cut.save(os.path.join(d, f"{k}.png")); cands.append(k)
        if cands and os.path.exists(os.path.join(d, "0.jpg")):
            rows.append({**p, "candidates": cands}); print("ok", p["name"][:60], cands)
        else:
            print("no usable photo", p["productId"], p["name"][:60])
    json.dump(rows, open(os.path.join(OUT, "queue.json"), "w"), indent=1)
    sheets(rows)
    left = len(queue) - len(rows)
    print(f"made {len(rows)}; {left} still waiting after this batch")


if __name__ == "__main__":
    main()
