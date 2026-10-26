"""Stream a SoccerTrack COCO GSR file into a small local replay clip.

Install the optional streaming dependency: python3 -m pip install ijson
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gsr', required=True, type=Path)
    parser.add_argument('--bas', required=True, type=Path)
    parser.add_argument('--half', type=int, choices=[1, 2], default=1)
    parser.add_argument('--start', type=float, default=0, help='Seconds into the half video')
    parser.add_argument('--seconds', type=float, default=120)
    parser.add_argument('--fps', type=float, default=25)
    parser.add_argument('--sample-fps', type=float, default=5)
    parser.add_argument('--out', type=Path, default=Path('clips'))
    args = parser.parse_args()
    if args.start < 0 or args.seconds <= 0 or not 0 < args.sample_fps <= args.fps:
        parser.error('Require start >= 0, seconds > 0, and 0 < sample-fps <= fps.')
    try:
        import ijson
    except ImportError:
        parser.error('Install the streaming reader first: python3 -m pip install ijson')
    # Stream the images table; never load the multi-GB GSR into memory.
    with args.gsr.open('rb') as source:
        origin = min((int(r.get('image_id', r.get('id'))) for r in ijson.items(source, 'images.item')), default=None)
    if origin is None:
        parser.error('This tool expects a SoccerTrack COCO object with an images array.')
    step = max(1, round(args.fps / args.sample_fps))
    groups = {}
    with args.gsr.open('rb') as source:
        for row in ijson.items(source, 'annotations.item'):
            if row.get('supercategory', 'object') != 'object':
                continue
            frame = int(row['image_id']) - origin
            t = frame / args.fps
            if not args.start <= t <= args.start + args.seconds or frame % step:
                continue
            attrs, box = row.get('attributes', row), row.get('bbox_pitch', {})
            x, y = row.get('x', box.get('x_bottom_middle')), row.get('y', box.get('y_bottom_middle'))
            if x is None or y is None:
                continue
            player_id = attrs.get('player_id')
            player = {
                'id': str(player_id if player_id is not None else row.get('track_id', row['id'])),
                'number': attrs.get('jersey_number', attrs.get('jersey')),
                'team': attrs.get('team_side', attrs.get('team')),
                'role': attrs.get('role', 'player'), 'x': float(x), 'y': float(y),
            }
            groups.setdefault(round(t - args.start, 6), []).append(player)
    if not groups:
        parser.error('No positions in the selected interval; no output was written.')
    bas = json.loads(args.bas.read_text())
    events = []
    for row in bas.get('annotations', bas.get('actions', [])):
        half = int(row.get('gameTime', '1 - 00:00').split(' - ')[0])
        t = float(row['position']) / 1000
        if half == args.half and args.start <= t <= args.start + args.seconds:
            events.append({**row, 'position': str(round((t - args.start) * 1000))})
    args.out.mkdir(parents=True, exist_ok=True)
    metadata = {'half': args.half, 'clip_start_seconds': args.start, 'synthetic': False}
    gsr_out = args.out / 'clip_gsr.json'
    bas_out = args.out / 'clip_bas.json'
    gsr_out.write_text(json.dumps({**metadata, 'frames': [{'t': t, 'players': p} for t, p in sorted(groups.items())]}))
    bas_out.write_text(json.dumps({**metadata, 'annotations': events}))
    print(f'Saved {len(groups)} position frames and {len(events)} events to {args.out}')
    print('Timing assumes release v1.2 (BAS milliseconds relative to each half video).')


if __name__ == '__main__':
    main()
