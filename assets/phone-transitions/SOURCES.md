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
| cafe-provence | e7956548-8675-48b0-89d8-325ae4cd6b24 | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_e7956548-8675-48b0-89d8-325ae4cd6b24.mp4 |
| coffee-riviera | 0bcee0e1-affe-439e-aab1-f5af4f357b13 | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171344_0bcee0e1-affe-439e-aab1-f5af4f357b13.mp4 |
| resto-orangerie | 5f81ca81-9d04-4d59-a241-83f03228ddec | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_5f81ca81-9d04-4d59-a241-83f03228ddec.mp4 |
| work-library | bbc8f8e9-4ab4-4af3-92d0-6be9cd8e09b6 | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_bbc8f8e9-4ab4-4af3-92d0-6be9cd8e09b6.mp4 |
| work-loft | aa7809d6-e392-41b7-b1f5-7dc7952e70e6 | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171344_aa7809d6-e392-41b7-b1f5-7dc7952e70e6.mp4 |
| home-estate | c85ea5de-59e1-4bb3-8488-819af9063e6a | https://d8j0ntlcm91z4.cloudfront.net/user_3HyG3R1H25xpTblgFPpSgfk7mlQ/hf_20261028_171343_c85ea5de-59e1-4bb3-8488-819af9063e6a.mp4 |

To finish: download each (audio stripped: `ffmpeg -i in.mp4 -an -c:v copy <film>.mp4`) into
this folder, run `node scripts/build-film-frames.mjs`, and commit `public/trade/f/*/phone.*`.
