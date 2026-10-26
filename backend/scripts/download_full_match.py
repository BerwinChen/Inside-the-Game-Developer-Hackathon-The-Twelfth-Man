"""Download only one full SoccerTrack match's GSR/BAS, with version and hashes pinned.
Run with python download_full_match.py after official HF authentication.
"""
import hashlib
import json
import shutil
from pathlib import Path

REPO = 'atomscott/soccertrack-v2'
REVISION = '325bd4c57ee8e135ab652f3921d274526ada496b'
FILES = [
    ('bas/117092/117092_12_class_events.json', 443655, 'git-sha1', '82e53e1f81ce2c677643ef55ddf25be5e20b0f6d'),
    ('gsr/117092/117092_1st.json', 2705362626, 'sha256', 'a70260a403e4d3011c11faef6aeaf529367afa1410f19b5e5042884cdcd36dfb'),
    ('gsr/117092/117092_2nd.json', 2709799141, 'sha256', '71734719a1eaa1167a33c7782070b3a95b0ea8344b431b930aa4a0c0fdd4fbd0'),
]

def main():
    from huggingface_hub import get_token, hf_hub_download
    from huggingface_hub.errors import GatedRepoError
    token = get_token()
    if not token:
        raise SystemExit('No local Hugging Face login is available. Accept dataset access in your browser, then run hf auth login in your terminal. Do not share tokens in chat.')
    dest = Path(__file__).resolve().parent.parent / 'data' / 'soccertrack-full' / '117092'
    dest.mkdir(parents=True, exist_ok=True)
    needed = sum(size for name, size, _, _ in FILES if not (dest / name).is_file())
    if shutil.disk_usage(dest).free < needed + 1024**3:
        raise SystemExit('Insufficient free disk space for the requested files plus 1 GiB headroom.')
    manifest = {'dataset': REPO, 'revision': REVISION, 'match_id': '117092', 'license': 'CC BY 4.0', 'files': []}
    for name, size, algorithm, checksum in FILES:
        print('Downloading:', name, flush=True)
        try:
            path = Path(hf_hub_download(repo_id=REPO, repo_type='dataset', revision=REVISION, filename=name, local_dir=dest, token=token))
        except GatedRepoError:
            raise SystemExit('Dataset access is not authorized for the local HF account. Review and accept its conditions at https://huggingface.co/datasets/atomscott/soccertrack-v2') from None
        if path.stat().st_size != size:
            raise SystemExit('Unexpected downloaded size: ' + name)
        digest = hashlib.sha256() if algorithm == 'sha256' else hashlib.sha1()
        if algorithm == 'git-sha1':
            digest.update(('blob ' + str(size) + '\0').encode())
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(8 * 1024**2), b''):
                digest.update(chunk)
        if digest.hexdigest() != checksum:
            raise SystemExit('Downloaded checksum mismatch: ' + name)
        manifest['files'].append({'path': name, 'bytes': size, 'checksum_algorithm': algorithm, 'checksum': checksum})
        print('Verified:', name, flush=True)
    (dest / 'download-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (dest / 'SOURCE.txt').write_text('SoccerTrack v2, match 117092, full first and second halves plus BAS.\nAuthors: Atom Scott, Ikuma Uchida, Kento Kuroda, Yufi Kim, Keisuke Fujii.\nSource: https://huggingface.co/datasets/atomscott/soccertrack-v2\nRevision: ' + REVISION + '\nLicense: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/\nChanges: none to source JSON. Videos are not downloaded.\nExact frame coverage and event alignment still require inspection after download.\n')
    print('Full annotation files downloaded and verified:', dest)

if __name__ == '__main__':
    main()
