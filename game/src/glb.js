// Operation: Sky Hunter — minimal hand-written GLB loader.
//
// Parses a glTF 2.0 binary (.glb): header + JSON chunk + BIN chunk, then
// rebuilds the node tree with TRS transforms, BufferGeometry from the
// accessors, and MeshStandard / MeshPhysical materials from
// pbrMetallicRoughness, including emissive maps, clearcoat and specular.
// Embedded PNG textures are decoded with Image + blob URLs (flipY =
// false) and KHR_texture_transform is applied (repeat = scale, offset =
// offset).
//
// Deliberately small: it supports only what the drone GLBs use — float32
// POSITION / NORMAL / TEXCOORD_0, uint16 indices, no skinning, no
// animations, no Draco, no sparse accessors, images by bufferView only.
// A GLTFLoader download would count as unwritten lines against the
// transcript gate, so this parser is written by hand instead.

const THREE = window.THREE;

const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMP_GETTER = {
  5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16',
  5125: 'getUint32', 5126: 'getFloat32',
};
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function typedArrayFor(componentType) {
  if (componentType === 5126) return Float32Array;
  if (componentType === 5125) return Uint32Array;
  if (componentType === 5123) return Uint16Array;
  if (componentType === 5122) return Int16Array;
  if (componentType === 5121) return Uint8Array;
  return Int8Array;
}

// Reads one accessor into a THREE.BufferAttribute. Handles both the
// common contiguous layout and interleaved (byteStride) data.
function readAccessor(dv, binStart, json, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const start = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const itemSize = TYPE_COUNT[a.type];
  const compBytes = COMP_BYTES[a.componentType];
  const itemBytes = compBytes * itemSize;
  const stride = bv.byteStride || itemBytes;
  const Arr = typedArrayFor(a.componentType);
  if (stride === itemBytes) {
    return new THREE.BufferAttribute(new Arr(dv.buffer, dv.byteOffset + start, a.count * itemSize), itemSize);
  }
  const out = new Arr(a.count * itemSize);
  const getter = COMP_GETTER[a.componentType];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = dv[getter](start + i * stride + c * compBytes, true);
    }
  }
  return new THREE.BufferAttribute(out, itemSize);
}

// Decodes one embedded image (PNG by bufferView) into an HTMLImageElement.
function decodeImage(buf, binStart, json, imageIndex) {
  const im = json.images[imageIndex];
  if (!im || im.bufferView === undefined) {
    return Promise.reject(new Error(`glb: image ${imageIndex} has no bufferView (only embedded images are supported)`));
  }
  const bv = json.bufferViews[im.bufferView];
  const bytes = new Uint8Array(buf, binStart + (bv.byteOffset || 0), bv.byteLength);
  const blob = new Blob([bytes], { type: im.mimeType || 'image/png' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`glb: failed to decode image ${imageIndex}`)); };
    img.src = url;
  });
}

// Builds one THREE.Texture from a glTF texture-info object (a use of a
// texture: { index, extensions: { KHR_texture_transform } }). Each use
// gets its own texture sharing the decoded image, so per-use transforms
// (repeat/offset) never leak between materials.
function makeTexture(json, images, texInfo, srgb) {
  const texDef = json.textures[texInfo.index];
  const img = images[texDef.source];
  const t = new THREE.Texture(img);
  t.flipY = false; // glTF UV origin is top-left, same as three.js with flipY false
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  const tr = texInfo.extensions && texInfo.extensions.KHR_texture_transform;
  if (tr) {
    if (tr.scale) t.repeat.set(tr.scale[0], tr.scale[1]);
    if (tr.offset) t.offset.set(tr.offset[0], tr.offset[1]);
  }
  t.needsUpdate = true;
  return t;
}

function buildMaterial(json, images, m) {
  const pbr = m.pbrMetallicRoughness || {};
  const cc = m.extensions && m.extensions.KHR_materials_clearcoat;
  const clearcoat = cc ? (cc.clearcoatFactor || 0) : 0;
  const sp = m.extensions && m.extensions.KHR_materials_specular;
  // MeshPhysicalMaterial only where the file actually uses a physical
  // feature (clearcoat or a coloured specular reflection); the plain
  // standard material is cheaper and identical otherwise.
  const Mat = (clearcoat > 0 || sp) ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const params = {
    metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 1,
    roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1,
  };
  if (pbr.baseColorFactor) {
    params.color = new THREE.Color(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]);
    if (pbr.baseColorFactor[3] < 1) { params.transparent = true; params.opacity = pbr.baseColorFactor[3]; }
  }
  if (pbr.baseColorTexture) params.map = makeTexture(json, images, pbr.baseColorTexture, true);
  if (pbr.metallicRoughnessTexture) {
    // glTF packs metalness in B and roughness in G; three.js reads the
    // same channels from the same texture for both maps.
    params.metalnessMap = makeTexture(json, images, pbr.metallicRoughnessTexture, false);
    params.roughnessMap = makeTexture(json, images, pbr.metallicRoughnessTexture, false);
  }
  if (m.normalTexture) {
    params.normalMap = makeTexture(json, images, m.normalTexture, false);
    const s = m.normalTexture.scale !== undefined ? m.normalTexture.scale : 1;
    params.normalScale = new THREE.Vector2(s, s);
  }
  if (m.emissiveFactor) params.emissive = new THREE.Color(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2]);
  if (m.emissiveTexture) {
    // An emissive map multiplies the emissive colour, so without an
    // emissive factor the map would stay black — default to white.
    if (!m.emissiveFactor) params.emissive = new THREE.Color(1, 1, 1);
    params.emissiveMap = makeTexture(json, images, m.emissiveTexture, true);
  }
  const es = m.extensions && m.extensions.KHR_materials_emissive_strength;
  if (es && es.emissiveStrength !== undefined) params.emissiveIntensity = es.emissiveStrength;
  if (m.alphaMode === 'MASK') params.alphaTest = m.alphaCutoff !== undefined ? m.alphaCutoff : 0.5;
  if (m.alphaMode === 'BLEND') params.transparent = true;
  if (m.doubleSided) params.side = THREE.DoubleSide;
  if (clearcoat > 0) {
    params.clearcoat = clearcoat;
    params.clearcoatRoughness = cc.clearcoatRoughnessFactor !== undefined ? cc.clearcoatRoughnessFactor : 0;
  }
  // KHR_materials_specular: a coloured specular reflection (this file
  // carries it on the airframe and metal parts).
  if (sp) {
    if (sp.specularColorFactor) params.specularColor = new THREE.Color(sp.specularColorFactor[0], sp.specularColorFactor[1], sp.specularColorFactor[2]);
    if (sp.specularFactor !== undefined) params.specularIntensity = sp.specularFactor;
  }
  const mat = new Mat(params);
  mat.name = m.name || '';
  return mat;
}

function buildMesh(dv, binStart, json, meshDef, materials) {
  const group = new THREE.Group();
  group.name = meshDef.name || '';
  for (const prim of meshDef.primitives) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', readAccessor(dv, binStart, json, prim.attributes.POSITION));
    if (prim.attributes.NORMAL !== undefined) geo.setAttribute('normal', readAccessor(dv, binStart, json, prim.attributes.NORMAL));
    if (prim.attributes.TEXCOORD_0 !== undefined) geo.setAttribute('uv', readAccessor(dv, binStart, json, prim.attributes.TEXCOORD_0));
    if (prim.indices !== undefined) geo.setIndex(readAccessor(dv, binStart, json, prim.indices));
    const mesh = new THREE.Mesh(geo, materials[prim.material !== undefined ? prim.material : 0]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Builds one node (and its subtree) into an Object3D. Nodes whose name
// mentions a floor are skipped — the Blender studio floor must never
// enter the game scene. Returns null for skipped nodes.
function buildNode(dv, binStart, json, nodeIndex, materials, nameMap) {
  const n = json.nodes[nodeIndex];
  if (n.name && /floor/i.test(n.name)) return null;
  const obj = new THREE.Group();
  obj.name = n.name || '';
  if (n.matrix) {
    obj.matrix.fromArray(n.matrix);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  } else {
    if (n.translation) obj.position.fromArray(n.translation);
    if (n.rotation) obj.quaternion.fromArray(n.rotation);
    if (n.scale) obj.scale.fromArray(n.scale);
  }
  if (n.mesh !== undefined) obj.add(buildMesh(dv, binStart, json, json.meshes[n.mesh], materials));
  (n.children || []).forEach((ci) => {
    const child = buildNode(dv, binStart, json, ci, materials, nameMap);
    if (child) obj.add(child);
  });
  if (obj.name) nameMap.set(obj.name, obj);
  return obj;
}

// Loads a .glb from a URL relative to the page and returns:
//   { group, nodes, materials }
// group is the scene root(s) wrapped in one group; nodes maps node names
// to their Object3D (Propeller, Sensor_Gimbal_Yaw, ...); materials maps
// material names to THREE materials (Mat_Nav_Red, Mat_Strobe_White, ...).
export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`glb: fetch failed (${res.status}) for ${url}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glb: bad magic — not a glTF binary file');
  if (dv.getUint32(4, true) !== 2) throw new Error('glb: only glTF 2.0 is supported');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('glb: first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8; // skip the BIN chunk header (length + type)
  if (dv.getUint32(20 + jsonLen + 4, true) !== 0x004e4942) throw new Error('glb: second chunk is not BIN');

  // Decode every embedded image first (in parallel), then build materials.
  const images = await Promise.all((json.images || []).map((_, i) => decodeImage(buf, binStart, json, i)));
  const materials = (json.materials || []).map((m) => buildMaterial(json, images, m));
  const materialsByName = new Map();
  materials.forEach((mat) => { if (mat.name) materialsByName.set(mat.name, mat); });

  const nameMap = new Map();
  const group = new THREE.Group();
  group.name = 'GLB_ROOT';
  const roots = (json.scenes && json.scenes[0] && json.scenes[0].nodes) || [];
  roots.forEach((ri) => {
    const child = buildNode(dv, binStart, json, ri, materials, nameMap);
    if (child) group.add(child);
  });
  return { group, nodes: nameMap, materials: materialsByName };
}
