"""Builds the 3D prototype's assets from the two free Quaternius packs (CC0 1.0, quaternius.com):

  Universal Animation Library[Standard].zip  ->  public/3d/clips.glb   (only the clips we use)
  Universal Base Characters[Standard].zip    ->  public/3d/player.glb  (the male base mesh, no textures)
                                             ->  public/3d/clips.json  (each loop's ground speed)
                                             ->  public/3d/hair.glb    (its hairstyles and beard, in place on the male head)

Usage: python scripts/prepare-3d-assets.py <unzipped animation library dir> <unzipped base characters dir>
       python scripts/prepare-3d-assets.py --hair <unzipped base characters dir>   (only hair.glb)

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


# The pack's hair meshes ('Rigged to Head Bone', in place on the head in the bind pose), by our name.
# The male ones fit our male base head as they are. The female ones were made on the female head, which
# is the same size but 4.3 cm lower (crown 1.767 against 1.81, brows 4.2 cm lower): lifted onto ours,
# a touch larger about the middle of the head so they sit on it, not in it. (Its Hair_Buns, two side
# buns with long strands, is left out: our bun is a single topknot, as in the 2D portraits.)
HAIR = {
    'buzzed': ('Hair_Buzzed', False),
    'parted': ('Hair_SimpleParted', False),
    'beard': ('Hair_Beard', False),
    'long': ('Hair_Long', True),
}
FEMALE_LIFT = 0.043
FEMALE_SCALE = 1.03
HEAD_MIDDLE_Y = 1.69


def build_hair(ubc_dir, out_dir):
    hdir = os.path.join(ubc_dir, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')
    out = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def add(raw, acc):
        while len(out) % 4:
            out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)})
        out.extend(raw)
        acc['bufferView'] = len(views) - 1
        accessors.append(acc)
        return len(accessors) - 1

    for name, (src, female) in HAIR.items():
        j, data = read_gltf(os.path.join(hdir, src + '.gltf'))
        prims = []
        for m in j['meshes']:
            for p in m['primitives']:
                pos = list(floats(j, data, p['attributes']['POSITION']))
                nor = floats(j, data, p['attributes']['NORMAL'])
                if female:
                    for k in range(0, len(pos), 3):
                        pos[k] *= FEMALE_SCALE
                        pos[k + 1] = HEAD_MIDDLE_Y + (pos[k + 1] + FEMALE_LIFT - HEAD_MIDDLE_Y) * FEMALE_SCALE
                        pos[k + 2] *= FEMALE_SCALE
                xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
                n = len(pos) // 3
                pa = add(struct.pack('<%df' % len(pos), *pos), {'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]})
                na = add(struct.pack('<%df' % len(nor), *nor), {'componentType': 5126, 'count': n, 'type': 'VEC3'})
                ia_src = j['accessors'][p['indices']]
                ia = add(accessor_bytes(j, data, p['indices']), {'componentType': ia_src['componentType'], 'count': ia_src['count'], 'type': 'SCALAR'})
                prims.append({'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia})
        meshes.append({'name': name, 'primitives': prims})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
    while len(out) % 4:
        out.append(0)
    gl = {'asset': {'version': '2.0', 'generator': 'prepare-3d-assets.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes,
          'meshes': meshes, 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(out)}]}
    write_glb(os.path.join(out_dir, 'hair.glb'), gl, bytes(out))
    print('hair.glb', os.path.getsize(os.path.join(out_dir, 'hair.glb')))


def write_license(out_dir):
    open(os.path.join(out_dir, 'LICENSE.txt'), 'w').write(
        'player.glb, hair.glb and clips.glb are built from Quaternius packs (Universal Base Characters, Universal\n'
        'Animation Library; Standard versions), released under CC0 1.0 Universal (public domain):\n'
        'https://creativecommons.org/publicdomain/zero/1.0/  -  https://quaternius.com\n'
        '(Each zip\'s own licence file, License_Standard.txt: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication".)\n')


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
    build_hair(ubc_dir, out_dir)
    write_license(out_dir)
    for f in ('clips.glb', 'player.glb', 'clips.json'):
        print(f, os.path.getsize(os.path.join(out_dir, f)))
    print(json.dumps(speeds, indent=1))


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'public', '3d')
    if sys.argv[1] == '--hair':
        build_hair(sys.argv[2], out)
        write_license(out)
    else:
        main(sys.argv[1], sys.argv[2], out)
