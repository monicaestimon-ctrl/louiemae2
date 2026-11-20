"""Seamless cutouts, step 2 of 2: save the reviewed candidates to the products.

    CONVEX_DEPLOY_KEY=<production deploy key> python3 scripts/cutouts/upload.py 1.0 2.1 5.0 [--draft 7.2]

Each argument is "<row>.<candidate>" from the sheets made by make.py. They are saved as approved
cutouts (shown on the site at once); anything after --draft is saved as a draft for a person to look at
in Admin -> Asset readiness. Rows not named are left alone and come back in the next batch.
"""
import io, json, os, subprocess, sys, urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, ".cutouts")


def convex(fn, args):
    r = subprocess.run(["npx", "convex", "run", fn, json.dumps(args)], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(r.stdout) if r.stdout.strip() else None


def main():
    rows = json.load(open(os.path.join(OUT, "queue.json")))
    status = "approved"; failed = False
    for arg in sys.argv[1:]:
        if arg == "--draft":
            status = "draft"; continue
        r, k = (int(x) for x in arg.split("."))
        row = rows[r - 1]
        cut = Image.open(os.path.join(OUT, row["productId"], f"{k}.png")).convert("RGBA")
        buf = io.BytesIO(); cut.save(buf, "WEBP", quality=90, method=6)
        try:
            url = convex("holmAssets:cutoutUploadUrl", {})
            req = urllib.request.Request(url, data=buf.getvalue(), headers={"Content-Type": "image/webp"}, method="POST")
            storage_id = json.loads(urllib.request.urlopen(req, timeout=60).read())["storageId"]
            convex("holmAssets:saveCutoutInternal", {"productId": row["productId"], "cutoutId": storage_id,
                                                      "aspect": round(cut.width / cut.height, 4), "status": status})
            print(status, arg, row["name"][:60])
        except Exception as e:  # noqa: BLE001 - report every failure, then exit nonzero
            failed = True; print("FAILED", arg, row["name"][:60], e)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
