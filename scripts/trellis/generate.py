"""Image-to-3D for the curated House pieces with TRELLIS on Hugging Face (trellis-community/TRELLIS).

    HF_TOKEN=... python3 scripts/trellis/generate.py 3 4 8 9   # ids to generate
    SEED=7 OVERWRITE=1 python3 scripts/trellis/generate.py 3     # retry a piece with another seed

Reads the studio cutout public/trade/c/<id>.webp and writes the raw GLB and its preview video to
.trellis/raw/. A free account has ~7 generations of ZeroGPU quota a day; HF PRO has ~25 min (all 24).
Then pack each one with scripts/trellis/pack.sh <id>. Exits nonzero if any piece failed.
"""
import os, sys, shutil, time
from gradio_client import Client, handle_file
from PIL import Image

RAW = ".trellis/raw"
os.makedirs(RAW, exist_ok=True)
client = Client("trellis-community/TRELLIS", token=os.environ["HF_TOKEN"])
seed = int(os.environ.get("SEED", "0"))
overwrite = os.environ.get("OVERWRITE") == "1"
failed = False
for i in sys.argv[1:]:
    dst = f"{RAW}/{i}.glb"
    if os.path.exists(dst) and not overwrite:
        print(i, "exists (set OVERWRITE=1 to regenerate)")
        continue
    png = f"{RAW}/{i}.png"
    Image.open(f"public/trade/c/{i}.webp").save(png)
    t = time.time()
    try:
        client.predict(api_name="/start_session")
        pre = client.predict(image=handle_file(png), api_name="/preprocess_image")
        r = client.predict(image=handle_file(pre), multiimages=[], seed=seed, ss_guidance_strength=7.5, ss_sampling_steps=12,
                           slat_guidance_strength=3.0, slat_sampling_steps=12, multiimage_algo="stochastic",
                           mesh_simplify=0.95, texture_size=1024, api_name="/generate_and_extract_glb")
        shutil.copy(r[2], dst)
        shutil.copy(r[0]["video"], f"{RAW}/{i}.mp4")
        print(i, "ok", round(time.time() - t), "s", flush=True)
    except Exception as e:  # noqa: BLE001 - the Space reports quota and queue errors as plain exceptions
        failed = True
        print(i, "FAIL", repr(e)[:300], flush=True)
        if "quota" in str(e):
            break
sys.exit(1 if failed else 0)
