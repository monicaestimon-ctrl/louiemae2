# Phone film transitions

One generated shot per room: the camera pushes down into the clay model while its
furniture and walls take on their colour in place. Generated with MiniMax H3 on Higgsfield
(5 s, 2K, 3:4), start frame = the film at `phoneCut().clay.end`, end frame = the film at
`phoneCut().color.start`, both as the phone's 3:4 crop (see `trade/phoneCut.mjs`).
`scripts/build-film-frames.mjs` splices `<film>.mp4` between the film's own footage.

| Room | Higgsfield job | Source |
| --- | --- | --- |
| bar | 670679c8-1fab-4050-97b5-d809c9e859db | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_670679c8-1fab-4050-97b5-d809c9e859db.mp4 |
| cafe-paris | 165f8936-7bf2-435d-9d2e-1ea4731d1bbb | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_052228_165f8936-7bf2-435d-9d2e-1ea4731d1bbb.mp4 |
| cafe-provence | b23a38fc-03aa-47d5-bd13-70d87f38cc0d (v2, start 6.5 s) | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_214706_b23a38fc-03aa-47d5-bd13-70d87f38cc0d.mp4 |
| coffee-riviera | cea17a69-3caa-4e2d-a839-afc4064699d5 (v2, ceiling sculpture forms in place) | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_223310_cea17a69-3caa-4e2d-a839-afc4064699d5.mp4 |
| resto-orangerie | 5f81ca81-9d04-4d59-a241-83f03228ddec | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_5f81ca81-9d04-4d59-a241-83f03228ddec.mp4 |
| work-library | bbc8f8e9-4ab4-4af3-92d0-6be9cd8e09b6 | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_bbc8f8e9-4ab4-4af3-92d0-6be9cd8e09b6.mp4 |
| work-loft | 113362a6-3fcb-4de0-a11d-e6a7dd94c683 (v2, start 6.5 s) | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_214706_113362a6-3fcb-4de0-a11d-e6a7dd94c683.mp4 |
| home-estate | c85ea5de-59e1-4bb3-8488-819af9063e6a | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_c85ea5de-59e1-4bb3-8488-819af9063e6a.mp4 |

Each clip is retimed to one constant camera pace from `pace.json` (written by
`scripts/measure-transition-pace.py`; re-run it after replacing a clip).

To finish: download each (audio stripped: `ffmpeg -i in.mp4 -an -c:v copy <film>.mp4`) into
this folder, run `node scripts/build-film-frames.mjs`, and commit `public/trade/f/*/phone.*`.
