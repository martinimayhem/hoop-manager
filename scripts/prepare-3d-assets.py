"""Builds the 3D prototype's assets from the two free Quaternius packs (CC0 1.0, quaternius.com):

  Universal Animation Library[Standard].zip  ->  public/3d/clips.glb   (only the clips we use)
  Universal Base Characters[Standard].zip    ->  public/3d/player.glb  (the male base mesh, no textures)
                                             ->  public/3d/clips.json  (each loop's ground speed)

Usage: python scripts/prepare-3d-assets.py <unzipped animation library dir> <unzipped base characters dir>

The clip speeds come from the root-motion version of the library: how far the root travels in one
cycle. Played at the player's real speed, a loop then covers the ground its feet do: no sliding.
"""
import json
import os
import struct
import sys

CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land']
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bn = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + bn]


def read_gltf(path):
    j = json.load(open(path, encoding='utf8'))
    return j, open(os.path.join(os.path.dirname(path), j['buffers'][0]['uri']), 'rb').read()


def accessor_bytes(j, data, i):
    a = j['accessors'][i]
    v = j['bufferViews'][a['bufferView']]
    size = COMPONENTS[a['type']] * {5126: 4, 5123: 2, 5125: 4, 5121: 1, 5122: 2, 5120: 1}[a['componentType']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', size)
    if stride == size:
        return data[start:start + size * a['count']]
    return b''.join(data[start + k * stride:start + k * stride + size] for k in range(a['count']))


def floats(j, data, i):
    raw = accessor_bytes(j, data, i)
    return struct.unpack('<%df' % (len(raw) // 4), raw)


def rebuild(j, data, keep_accessors):
    """A new JSON + binary with only the given accessors, each in its own tightly packed buffer view."""
    out = bytearray()
    views, accessors, remap = [], [], {}
    for i in sorted(keep_accessors):
        raw = accessor_bytes(j, data, i)
        while len(out) % 4:
            out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)})
        out += raw
        a = dict(j['accessors'][i])
        a['bufferView'] = len(views) - 1
        a.pop('byteOffset', None)
        remap[i] = len(accessors)
        accessors.append(a)
    while len(out) % 4:
        out.append(0)
    return views, accessors, remap, bytes(out)


def write_glb(path, j, data):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(data), b'BIN\x00') + data)


def main(ual_dir, ubc_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    lib = os.path.join(ual_dir, 'Unreal-Godot')

    # Clips: the skeleton's nodes and the animations we use, nothing else (no mannequin mesh).
    j, data = read_glb(os.path.join(lib, 'UAL1_Standard.glb'))
    anims = [a for a in j['animations'] if a['name'] in CLIPS]
    keep = set()
    for a in anims:
        for s in a['samplers']:
            keep.update([s['input'], s['output']])
    views, accessors, remap, blob = rebuild(j, data, keep)
    nodes = [{k: v for k, v in n.items() if k not in ('mesh', 'skin')} for n in j['nodes']]
    for a in anims:
        for s in a['samplers']:
            s['input'], s['output'] = remap[s['input']], remap[s['output']]
    out = {'asset': j['asset'], 'scene': 0, 'scenes': j['scenes'], 'nodes': nodes, 'animations': anims,
           'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    write_glb(os.path.join(out_dir, 'clips.glb'), out, blob)

    # Ground speed of each loop: the root's travel in the root-motion version over the clip's length.
    rj, rdata = read_glb(os.path.join(lib, 'UAL1_Standard_RM.glb'))
    names = [n.get('name') for n in rj['nodes']]
    speeds = {}
    for a in rj['animations']:
        if a['name'] not in CLIPS:
            continue
        for ch in a['channels']:
            t = ch['target']
            if t['path'] == 'translation' and names[t['node']] == 'root':
                s = a['samplers'][ch['sampler']]
                times = floats(rj, rdata, s['input'])
                pos = floats(rj, rdata, s['output'])
                dx, dz = pos[-3] - pos[0], pos[-1] - pos[2]
                dy = pos[-2] - pos[1]
                dur = times[-1] - times[0]
                speeds[a['name']] = {'duration': round(dur, 4), 'distance': round((dx * dx + dy * dy + dz * dz) ** 0.5, 4), 'speed': round(((dx * dx + dy * dy + dz * dz) ** 0.5) / dur, 4) if dur else 0}
    json.dump(speeds, open(os.path.join(out_dir, 'clips.json'), 'w'), indent=2)

    # The player: the male base mesh, skinned, with plain untextured materials (we colour it ourselves).
    cdir = os.path.join(ubc_dir, 'Base Characters', 'Godot - UE')
    cj, cdata = read_gltf(os.path.join(cdir, 'Superhero_Male_FullBody.gltf'))
    keep = set()
    for m in cj['meshes']:
        for p in m['primitives']:
            keep.update(p['attributes'].values())
            if 'indices' in p:
                keep.add(p['indices'])
    for s in cj['skins']:
        keep.add(s['inverseBindMatrices'])
    views, accessors, remap, blob = rebuild(cj, cdata, keep)
    for m in cj['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: remap[v] for k, v in p['attributes'].items() if k in ('POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0')}
            if 'indices' in p:
                p['indices'] = remap[p['indices']]
    for s in cj['skins']:
        s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
    materials = [{'name': m['name'], 'pbrMetallicRoughness': {'baseColorFactor': [0.8, 0.8, 0.8, 1], 'metallicFactor': 0, 'roughnessFactor': 1}} for m in cj['materials']]
    out = {'asset': cj['asset'], 'scene': 0, 'scenes': cj['scenes'], 'nodes': cj['nodes'], 'meshes': cj['meshes'], 'skins': cj['skins'],
           'materials': materials, 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    write_glb(os.path.join(out_dir, 'player.glb'), out, blob)
    open(os.path.join(out_dir, 'LICENSE.txt'), 'w').write(
        'player.glb and clips.glb are built from Quaternius packs (Universal Base Characters, Universal Animation\n'
        'Library; Standard versions), released under CC0 1.0 Universal (public domain):\n'
        'https://creativecommons.org/publicdomain/zero/1.0/  -  https://quaternius.com\n')
    for f in ('clips.glb', 'player.glb', 'clips.json'):
        print(f, os.path.getsize(os.path.join(out_dir, f)))
    print(json.dumps(speeds, indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], os.path.join(os.path.dirname(__file__), '..', 'public', '3d'))
