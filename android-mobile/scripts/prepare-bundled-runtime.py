"""Package current Bionic Node/JDK binaries as APK native libraries.

ELF parsing uses pyelftools. C-string replacements only shorten strings; ELF
segments, symbol offsets and relocation addresses never move. Original files
and their license notices remain in the ignored build cache.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--elftools', default='D:/Codex/UserData/tools/android/python-libs')
parser.add_argument('--app-id', default='dev.modmind')
args = parser.parse_args()
sys.path.insert(0, args.elftools)
from elftools.elf.elffile import ELFFile

root = Path(__file__).resolve().parent.parent
state = root / 'state'
archive = state / 'runtime-source.tar.gz'
old_prefix = '/data/data/com.termux/files/usr'
new_prefix = '/data/data/' + args.app_id + '/files/u'
if len(new_prefix) > len(old_prefix):
    raise RuntimeError('Runtime prefix must fit the original ELF string storage')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
source = state / ('runtime-source-' + digest[:16])
source.mkdir(parents=True, exist_ok=True)
links = {}
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar:
        name = member.name.rstrip('/')
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise RuntimeError('Unsafe runtime archive path')
        if member.issym() or member.islnk():
            links[name] = member.linkname
        elif member.isfile():
            file = source / name
            if not file.exists() or file.stat().st_size != member.size:
                file.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as inp, file.open('wb') as out:
                    shutil.copyfileobj(inp, out)

def normalize(name):
    parts = []
    for part in name.split('/'):
        if part == '..':
            if not parts:
                raise RuntimeError('Runtime link escapes source')
            parts.pop()
        elif part and part != '.':
            parts.append(part)
    return '/'.join(parts)

def resolve(name, seen=None):
    seen = set() if seen is None else seen
    name = normalize(name)
    if name in seen:
        raise RuntimeError('Cyclic runtime link: ' + name)
    seen.add(name)
    for index, part in enumerate(PurePosixPath(name).parts):
        candidate = '/'.join(PurePosixPath(name).parts[:index + 1])
        if candidate in links:
            target = links[candidate]
            if target.startswith(old_prefix + '/'):
                target = target[len(old_prefix) + 1:]
            elif target.startswith('/'):
                return target
            else:
                target = str(PurePosixPath(candidate).parent / target)
            rest = '/'.join(PurePosixPath(name).parts[index + 1:])
            return resolve(target + ('/' + rest if rest else ''), seen)
    return name

def is_elf(name):
    file = source / name
    return file.is_file() and file.open('rb').read(4) == b'\x7fELF'

def elf_info(data):
    elf = ELFFile(io.BytesIO(data))
    if elf.header['e_machine'] != 'EM_AARCH64':
        raise RuntimeError('Only ARM64 binaries are supported')
    segment = next((s for s in elf.iter_segments() if s.header.p_type == 'PT_DYNAMIC'), None)
    return [tag.needed for tag in segment.iter_tags() if tag.entry.d_tag == 'DT_NEEDED'] if segment else []

jdk = 'lib/jvm/java-21-openjdk'
roots = ['bin/node', 'bin/bash']
roots += [str(file.relative_to(source)).replace('\\', '/') for file in (source / jdk).rglob('*') if file.is_file() and is_elf(str(file.relative_to(source)).replace('\\', '/'))]
system = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so', 'libz.so', 'libEGL.so', 'libGLESv2.so'}
selected = {}
queue = roots[:]
while queue:
    name = resolve(queue.pop(0))
    if name in selected:
        continue
    if not is_elf(name):
        raise RuntimeError('Required native file is missing: ' + name)
    data = (source / name).read_bytes()
    dependencies = elf_info(data)
    selected[name] = {'dependencies': dependencies, 'sha256': hashlib.sha256(data).hexdigest()}
    for needed in dependencies:
        if needed in system:
            continue
        candidates = [str(PurePosixPath(name).parent / needed), jdk + '/lib/' + needed, jdk + '/lib/server/' + needed, 'lib/' + needed]
        target = next((resolve(candidate) for candidate in candidates if (source / resolve(candidate)).is_file()), None)
        if not target:
            raise RuntimeError('Missing native dependency: ' + needed + ' required by ' + name)
        queue.append(target)

aliases = {}
native_names = {}
for name in selected:
    base = PurePosixPath(name).name
    if '/bin/' in '/' + name or '.so' not in base:
        alias = 'libmm_' + re.sub('[^a-zA-Z0-9_]', '_', base) + '_exec.so'
    elif '.so.' in base:
        stem, version = base.split('.so.', 1)
        alias = stem + version.replace('.', '_') + '.so'
    else:
        alias = base
    if not alias.startswith('lib') or not alias.endswith('.so'):
        raise RuntimeError('Invalid APK native filename: ' + alias)
    if alias in native_names and selected[native_names[alias]]['sha256'] != selected[name]['sha256']:
        raise RuntimeError('Native filename collision: ' + alias)
    aliases[name] = alias
    native_names[alias] = name

def patch_strings(original, name):
    data = bytearray(original)
    needle = old_prefix.encode()
    allowed = None
    if name == 'bin/node':
        # V8 embeds serialized snapshots. Only its dynamic-linker string table
        # can be rewritten; changing snapshot bytes invalidates V8's checksum.
        elf = ELFFile(io.BytesIO(original))
        section = elf.get_section_by_name('.dynstr')
        allowed = (section.header.sh_offset, section.header.sh_offset + section.header.sh_size) if section else (0, 0)
    offset = 0
    while True:
        start = data.find(needle, offset)
        if start < 0:
            break
        if allowed and not allowed[0] <= start < allowed[1]:
            offset = start + len(needle)
            continue
        end = data.find(0, start)
        if end < 0 or end - start > 2048 or any(byte not in range(32, 127) and byte not in [9, 10, 13] for byte in data[start:end]):
            offset = start + len(needle)
            continue
        old = bytes(data[start:end])
        new = old.replace(needle, new_prefix.encode())
        data[start:end] = new + b'\0' * (len(old) - len(new))
        offset = end + 1
    return bytes(data)

native_root = root / 'android/app/src/main/jniLibs/arm64-v8a'
native_root.mkdir(parents=True, exist_ok=True)
for file in native_root.glob('*.so'):
    if file.name not in ['libmm_runtime_paths.so', 'libmm_codex_exec.so']:
        file.unlink()
for alias, name in native_names.items():
    original = (source / name).read_bytes()
    patched = patch_strings(original, name)
    elf_info(patched)
    (native_root / alias).write_bytes(patched)

native_links = {name: alias for name, alias in aliases.items()}
data_links = {}
for name, target in links.items():
    resolved = resolve(name)
    if resolved in aliases:
        native_links[name] = aliases[resolved]
    elif not name.startswith(jdk + '/'):
        continue
    elif resolved.startswith('/'):
        continue
    elif (source / resolved).is_file():
        data_links[name] = resolved
for name in ['java', 'javac', 'jar', 'javadoc', 'javap']:
    target = jdk + '/bin/' + name
    if target in native_links:
        native_links['bin/' + name] = native_links[target]

data_links['bin/sh'] = '/system/bin/sh'
assets = root / 'android/app/src/main/assets'
assets.mkdir(parents=True, exist_ok=True)
metadata = {'version': 1, 'sourceSha256': digest, 'prefix': new_prefix, 'nativeLinks': native_links, 'dataLinks': data_links, 'node': aliases['bin/node'], 'javaHome': jdk, 'bash': aliases['bin/bash'], 'sourceLibraries': selected}
with zipfile.ZipFile(assets / 'local-runtime.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
    for file in source.rglob('*'):
        if not file.is_file():
            continue
        name = str(file.relative_to(source)).replace('\\', '/')
        if name.startswith(jdk + '/') and name not in selected or name.startswith('etc/tls/') or name.startswith('share/doc/'):
            out.write(file, name)
    out.writestr('.native-links.json', json.dumps(metadata, ensure_ascii=False))
version = hashlib.sha256((assets / 'local-runtime.zip').read_bytes()).hexdigest()
(assets / 'local-runtime-version.json').write_text(json.dumps({'sha256': version, 'sourceSha256': digest}), encoding='utf8')
(state / 'bundled-runtime.json').write_text(json.dumps(metadata, indent=2), encoding='utf8')
print(json.dumps({'nativeLibraries': len(native_names), 'nativeBytes': sum(p.stat().st_size for p in native_root.glob('*.so')), 'dataArchiveBytes': (assets / 'local-runtime.zip').stat().st_size, 'sourceSha256': digest}))
